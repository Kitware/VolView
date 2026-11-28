import path from 'node:path';
import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import type { VolViewPage } from '../pageobjects/volview.page';
import type { Utils } from './utils';
import type { AnnotationUtils } from './annotationTestUtils';
import type { SegmentationUtils } from './segmentationTestUtils';

type Helpers = {
  page: Page;
  volview: VolViewPage;
  utils: Utils;
  segmentation: SegmentationUtils;
};

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
const installConversionGate = (page: Page) =>
  page.addInitScript(() => {
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
const toolButton = (page: Page, icon: string) =>
  page.locator(`button.tool-btn:has(i.${icon})`);

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

const prepareSelectedPaint = async (
  { page, volview, utils, segmentation }: Helpers,
  stem: string
) => {
  const imageName = utils.writeMetaImage(`${stem}-source.mha`, { size: 16 });
  await utils.writeManifestToFile(
    {
      layouts: { Axial: [['axial']] },
      segments: { Liver: { color: '#ff0000' }, Kidney: { color: '#00ff00' } },
    },
    `${stem}-source-config.json`
  );
  await utils.writeManifestToFile(
    {
      resources: [
        { url: '/tmp/' + imageName },
        { url: `/tmp/${stem}-source-config.json` },
      ],
    },
    `${stem}-source.json`
  );
  await utils.openVolViewPage(`${stem}-source.json`);
  await segmentation.openAnnotationSegments();
  await expect
    .poll(async () => (await segmentation.segmentNames()).join(','))
    .toBe('Liver,Kidney');
  await volview.activatePaint();
  await expect(toolButton(page, 'mdi-brush')).toHaveClass(
    /\btool-btn-selected\b/
  );

  // Clear Scene keeps the selected tool and configured seed definitions. This
  // also leaves the views empty, so the next ordinary import shows its primary.
  await page.keyboard.press('Control+/');
  await expect
    .poll(async () => (await segmentation.segmentNames()).length)
    .toBe(0);
  await expect(segmentation.createSegmentRow()).toBeDisabled();
};

const imageMetrics = async (utils: Utils) =>
  (await utils.capture2DViewScreenshotMetrics('segmentation-loading.png'))[0];

const moveOutsideImage = (annotation: AnnotationUtils) =>
  annotation.moveTo(10, 10);

const expectEditingEnabled = async ({ page, segmentation }: Helpers) => {
  await expect(segmentation.createSegmentRow()).toBeEnabled();
  for (const icon of editingTools) {
    await expect(toolButton(page, icon)).toBeVisible();
    await expect(toolButton(page, icon)).toBeEnabled();
  }
};

const loadCompanionWhile = async (
  helpers: Helpers,
  stem: string,
  duringConversion: () => Promise<void>
) => {
  const { page, utils, segmentation } = helpers;
  const directory = utils.makeTempDir(stem);
  writeVolume(path.join(directory, 'primary.nrrd'), 16, 1);
  writeVolume(path.join(directory, 'primary.seg.nrrd'), 8, 2, true);
  const manifest = await utils.writeManifestToFile(
    {
      resources: [
        { url: `/tmp/${stem}/primary.nrrd`, name: 'primary.nrrd' },
        { url: `/tmp/${stem}/primary.seg.nrrd`, name: 'primary.seg.nrrd' },
      ],
    },
    `${stem}-batch.json`
  );
  await prepareSelectedPaint(helpers, stem);
  await page.evaluate(() => {
    const gate = (window as ConversionGateWindow).segmentationConversionGate;
    gate.armed = true;
    gate.entered = false;
  });
  try {
    await utils.openThroughDialog(manifest);
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as ConversionGateWindow).segmentationConversionGate
                .entered
          ),
        {
          message:
            'Expected companion segmentation resampling to reach the worker gate',
        }
      )
      .toBe(true);
    await segmentation.openAnnotationSegments();
    await expect(segmentation.segmentImageName()).toHaveText('primary.nrrd');
    await expectEditingEnabled(helpers);
    expect(await segmentation.segmentNames()).toEqual(['Liver', 'Kidney']);
    await duringConversion();
  } finally {
    await page.evaluate(() => {
      const gate = (window as ConversionGateWindow).segmentationConversionGate;
      gate.armed = false;
      gate.release?.();
    });
  }
  await segmentation.waitForSegmentContent('Tumor');
};

test.describe('Segment definitions during companion loading', () => {
  test.beforeEach(({ page }) => installConversionGate(page));

  test('merges the companion segmentation into the configured definitions', async ({
    page,
    volview,
    utils,
    segmentation,
  }) => {
    await loadCompanionWhile(
      { page, volview, utils, segmentation },
      'segmentation-loading',
      async () => {}
    );

    expect(await segmentation.segmentNames()).toEqual([
      'Liver',
      'Kidney',
      'Tumor',
    ]);
    await expect
      .poll(async () => (await imageMetrics(utils)).colored, {
        message:
          'Expected the incoming Tumor mask to render on the primary image',
      })
      .toBeGreaterThan(0);
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('keeps definitions painted before the companion segmentation lands', async ({
    page,
    volview,
    utils,
    annotation,
    segmentation,
  }) => {
    await loadCompanionWhile(
      { page, volview, utils, segmentation },
      'segmentation-loading-painted',
      async () => {
        await volview.paintStrokeOnView(volview.views2D.first());
        await moveOutsideImage(annotation);
        await expect
          .poll(async () => (await imageMetrics(utils)).colored, {
            message: 'Expected the Liver stroke before conversion completes',
          })
          .toBeGreaterThan(0);
      }
    );

    expect(await segmentation.segmentNames()).toEqual([
      'Liver',
      'Kidney',
      'Tumor',
    ]);
    await segmentation.waitForSegmentContent('Liver');
    await (await segmentation.segmentRow('Tumor'))
      .locator('button[aria-label="Hide Tumor"]')
      .click();
    await expect
      .poll(async () => (await imageMetrics(utils)).colored, {
        message:
          'Expected the original Liver stroke after conversion completes',
      })
      .toBeGreaterThan(0);
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('treats an explicitly empty companion configuration as ready and editable', async ({
    page,
    volview,
    utils,
    annotation,
    segmentation,
  }) => {
    const helpers = { page, volview, utils, segmentation };
    const stem = 'segmentation-loading-empty';
    const directory = utils.makeTempDir(stem);
    writeVolume(path.join(directory, 'empty.nrrd'), 16, 1);
    await utils.writeManifestToFile({ segments: {} }, `${stem}-config.json`);
    const manifest = await utils.writeManifestToFile(
      {
        resources: [
          { url: `/tmp/${stem}/empty.nrrd`, name: 'empty.nrrd' },
          { url: `/tmp/${stem}-config.json` },
        ],
      },
      `${stem}-batch.json`
    );
    await prepareSelectedPaint(helpers, stem);
    await utils.openThroughDialog(manifest);
    await segmentation.openAnnotationSegments();
    await expect(segmentation.segmentImageName()).toHaveText('empty.nrrd');
    await expectEditingEnabled(helpers);
    expect(await segmentation.segmentNames()).toEqual([]);
    await segmentation.addSegment();
    expect(await segmentation.segmentNames()).toEqual(['Segment 1']);
    await volview.paintStrokeOnView(volview.views2D.first());
    await moveOutsideImage(annotation);
    await segmentation.waitForSegmentContent('Segment 1');
    await expect
      .poll(async () => (await imageMetrics(utils)).colored)
      .toBeGreaterThan(0);
    expect(await volview.getNotificationsCount()).toBe(0);
  });
});
