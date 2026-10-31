import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { volViewPage } from '../pageobjects/volview.page';
import {
  makeTempDir,
  openThroughDialog,
  openVolViewPage,
  writeManifestToFile,
  writeMetaImage,
} from './utils';
import {
  addSegment,
  openAnnotationSegments,
  segmentNames,
  waitForSegmentContent,
} from './segmentationTestUtils';

type ConversionGateWindow = Window &
  typeof globalThis & {
    segmentationConversionGate: {
      armed: boolean;
      entered: boolean;
      release?: () => void;
    };
  };

// A different voxel grid makes this companion use the real resampling worker.
// Holding one worker response leaves conversion pending after the primary image
// is visible, without changing application stores or import promises.
const installConversionGate = () =>
  browser.addInitScript(() => {
    const gate: ConversionGateWindow['segmentationConversionGate'] = {
      armed: false,
      entered: false,
    };
    (window as ConversionGateWindow).segmentationConversionGate = gate;
    window.Worker = new Proxy(window.Worker, {
      construct(target, args) {
        const worker = Reflect.construct(target, args) as Worker;
        let resampleRequestId: string | undefined;
        worker.postMessage = new Proxy(worker.postMessage, {
          apply(postMessage, receiver, messages) {
            const request = messages[0] as
              | {
                  id?: string;
                  type?: string;
                  path?: string[];
                  argumentList?: { value?: unknown }[];
                }
              | null
              | undefined;
            const pipelineArgs = request?.argumentList?.[2]?.value;
            // itk-wasm wraps HTTP worker scripts in blob URLs. Match its
            // Comlink call instead of the script URL, so imageIO decoding and
            // unrelated worker responses pass through before this gate.
            if (
              gate.armed &&
              request?.type === 'APPLY' &&
              request.path?.length === 1 &&
              request.path[0] === 'runPipeline' &&
              request.argumentList?.[0]?.value === 'resample' &&
              Array.isArray(pipelineArgs) &&
              pipelineArgs.includes('--label')
            ) {
              resampleRequestId = request.id;
            }
            return Reflect.apply(postMessage, receiver, messages);
          },
        });
        worker.addEventListener('message', (event) => {
          if (
            !gate.armed ||
            !resampleRequestId ||
            event.data?.id !== resampleRequestId
          )
            return;
          resampleRequestId = undefined;
          gate.armed = false;
          gate.entered = true;
          event.stopImmediatePropagation();
          gate.release = () => {
            gate.release = undefined;
            worker.dispatchEvent(
              new MessageEvent('message', { data: event.data })
            );
          };
        });
        return worker;
      },
    });
  });

const editingTools = [
  'mdi-brush',
  'mdi-ruler',
  'mdi-vector-square',
  'mdi-pentagon-outline',
];
const toolButton = (icon: string) => $(`button.tool-btn:has(i.${icon})`);
const loadingStatus = () => $('[data-testid="segment-list"] [role="status"]');
const newSegmentButton = () => $('[data-testid="segment-list"] .create-row');

const writeVolume = (
  filePath: string,
  size: number,
  spacing: number,
  segmentation = false
) => {
  const segmentFields = segmentation
    ? 'Segment0_LabelValue:=1\nSegment0_Name:=Tumor\nSegment0_Color:=0 0 1\n'
    : '';
  const header =
    'NRRD0005\ntype: unsigned char\ndimension: 3\n' +
    `space: left-posterior-superior\nsizes: ${size} ${size} ${size}\n` +
    `space directions: (${spacing},0,0) (0,${spacing},0) (0,0,${spacing})\n` +
    `space origin: (0,0,0)\n${segmentFields}encoding: raw\n\n`;
  const voxels = Buffer.from(
    Array.from({ length: size ** 3 }, (_, index) => {
      const i = index % size;
      const j = Math.floor(index / size) % size;
      const k = Math.floor(index / size ** 2);
      return segmentation
        ? Number(i >= 2 && i <= 5 && j >= 2 && j <= 5 && k >= 2 && k <= 5)
        : (i + j + k) * 4;
    })
  );
  writeFileSync(filePath, Buffer.concat([Buffer.from(header), voxels]));
};

const prepareSelectedPaint = async (stem: string) => {
  const imageName = writeMetaImage(`${stem}-source.mha`, { size: 16 });
  await writeManifestToFile(
    {
      layouts: { Axial: [['axial']] },
      segments: { Liver: { color: '#ff0000' }, Kidney: { color: '#00ff00' } },
    },
    `${stem}-source-config.json`
  );
  await writeManifestToFile(
    {
      resources: [
        { url: '/tmp/' + imageName },
        { url: `/tmp/${stem}-source-config.json` },
      ],
    },
    `${stem}-source.json`
  );
  await openVolViewPage(`${stem}-source.json`);
  await openAnnotationSegments();
  await browser.waitUntil(
    async () => (await segmentNames()).join(',') === 'Liver,Kidney'
  );
  await volViewPage.activatePaint();
  await expect(toolButton('mdi-brush')).toHaveElementClass('tool-btn-selected');

  // Clear Scene keeps the selected tool and configured seed definitions. This
  // also leaves the views empty, so the next ordinary import shows its primary.
  await browser.keys(['Control', '/']);
  await browser.waitUntil(async () => (await segmentNames()).length === 0);
  await expect(newSegmentButton()).toBeDisabled();
};

const imageMetrics = async () => {
  const canvas = await (await volViewPage.getViews2D())[0].$('canvas');
  return browser.execute(async (source) => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
    const imageCanvas = source as HTMLCanvasElement;
    const image = new Image();
    image.src = imageCanvas.toDataURL();
    await image.decode();
    const copy = document.createElement('canvas');
    copy.width = imageCanvas.width;
    copy.height = imageCanvas.height;
    const context = copy.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, copy.width, copy.height);
    let visiblePixels = 0;
    let coloredPixels = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
      const high = Math.max(data[offset], data[offset + 1], data[offset + 2]);
      const low = Math.min(data[offset], data[offset + 1], data[offset + 2]);
      if (data[offset + 3] && high > 20) visiblePixels++;
      if (data[offset + 3] && high - low > 10) coloredPixels++;
    }
    return { visiblePixels, coloredPixels };
  }, canvas);
};

const moveOutsideImage = () =>
  browser.action('pointer').move({ x: 10, y: 10 }).perform();

const expectEditingEnabled = async () => {
  await expect(newSegmentButton()).toBeEnabled();
  for (const icon of editingTools) {
    await expect(toolButton(icon)).toBeDisplayed();
    await expect(toolButton(icon)).toBeEnabled();
  }
};

describe('Segment definitions during companion loading', () => {
  before(installConversionGate);

  it('shows the primary image but blocks an already selected Paint until incoming definitions are ready', async () => {
    const stem = 'segmentation-loading';
    const directory = makeTempDir(stem);
    writeVolume(path.join(directory, 'primary.nrrd'), 16, 1);
    writeVolume(path.join(directory, 'primary.seg.nrrd'), 8, 2, true);
    const manifest = await writeManifestToFile(
      {
        resources: [
          { url: `/tmp/${stem}/primary.nrrd`, name: 'primary.nrrd' },
          { url: `/tmp/${stem}/primary.seg.nrrd`, name: 'primary.seg.nrrd' },
        ],
      },
      `${stem}-batch.json`
    );
    await prepareSelectedPaint(stem);
    await browser.execute(() => {
      const gate = (window as ConversionGateWindow).segmentationConversionGate;
      gate.armed = true;
      gate.entered = false;
    });
    try {
      await openThroughDialog(manifest);
      await browser.waitUntil(
        () =>
          browser.execute(
            () =>
              (window as ConversionGateWindow).segmentationConversionGate
                .entered
          ),
        {
          timeoutMsg:
            'Expected companion segmentation resampling to reach the worker gate',
        }
      );
      await openAnnotationSegments();
      await expect($('[data-testid="segment-image-name"]')).toHaveText(
        'primary.nrrd'
      );
      await expect(loadingStatus()).toHaveText(
        'Segment definitions are loading'
      );
      await expect(newSegmentButton()).toBeDisplayed();
      await expect(newSegmentButton()).toBeDisabled();
      for (const icon of editingTools) {
        await expect(toolButton(icon)).toBeDisplayed();
        await expect(toolButton(icon)).toBeDisabled();
      }
      await expect(toolButton('mdi-brush')).toHaveElementClass(
        'tool-btn-selected'
      );
      expect(await segmentNames()).toEqual([]);
      await moveOutsideImage();
      await browser.waitUntil(
        async () => (await imageMetrics()).visiblePixels > 0,
        {
          timeoutMsg:
            'Expected primary image pixels before companion conversion completes',
        }
      );
      expect((await imageMetrics()).coloredPixels).toBe(0);

      await volViewPage.paintStrokeOnView((await volViewPage.getViews2D())[0]);
      await moveOutsideImage();
      expect(await segmentNames()).toEqual([]);
      expect((await imageMetrics()).coloredPixels).toBe(0);
      await expect(loadingStatus()).toBeDisplayed();
    } finally {
      await browser.execute(() => {
        const gate = (window as ConversionGateWindow)
          .segmentationConversionGate;
        gate.armed = false;
        gate.release?.();
      });
    }

    await browser.waitUntil(
      async () => (await segmentNames()).join(',') === 'Tumor'
    );
    await waitForSegmentContent('Tumor');
    await expect(loadingStatus()).not.toExist();
    await expectEditingEnabled();
    expect(await segmentNames()).toEqual(['Tumor']);
    await browser.waitUntil(
      async () => (await imageMetrics()).coloredPixels > 0,
      {
        timeoutMsg:
          'Expected the incoming Tumor mask to render on the primary image',
      }
    );
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('treats an explicitly empty companion configuration as ready and editable', async () => {
    const stem = 'segmentation-loading-empty';
    const directory = makeTempDir(stem);
    writeVolume(path.join(directory, 'empty.nrrd'), 16, 1);
    await writeManifestToFile({ segments: {} }, `${stem}-config.json`);
    const manifest = await writeManifestToFile(
      {
        resources: [
          { url: `/tmp/${stem}/empty.nrrd`, name: 'empty.nrrd' },
          { url: `/tmp/${stem}-config.json` },
        ],
      },
      `${stem}-batch.json`
    );
    await prepareSelectedPaint(stem);
    await openThroughDialog(manifest);
    await openAnnotationSegments();
    await expect($('[data-testid="segment-image-name"]')).toHaveText(
      'empty.nrrd'
    );
    await expect(loadingStatus()).not.toExist();
    await expectEditingEnabled();
    expect(await segmentNames()).toEqual([]);
    await addSegment();
    expect(await segmentNames()).toEqual(['Segment 1']);
    await volViewPage.paintStrokeOnView((await volViewPage.getViews2D())[0]);
    await moveOutsideImage();
    await waitForSegmentContent('Segment 1');
    await browser.waitUntil(
      async () => (await imageMetrics()).coloredPixels > 0
    );
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });
});
