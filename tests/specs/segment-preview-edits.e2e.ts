import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { TEMP_DIR } from '../../wdio.shared.conf';
import AppPage, { setValueVueInput } from '../pageobjects/volview.page';
import {
  openAnnotationSegments,
  waitForSegmentContent,
} from './segmentationTestUtils';
import { waitForDownload } from './utils';

const SIZE = 64;
const originalCount = 48 ** 3 - 38 ** 3;
const filledCount = 48 ** 3;

function nrrd(data: Uint8Array) {
  return Buffer.concat([
    Buffer.from(
      `NRRD0005\ntype: unsigned char\ndimension: 3\nsizes: ${SIZE} ${SIZE} ${SIZE}\nspace: left-posterior-superior\nspace directions: (1,0,0) (0,1,0) (0,0,1)\nspace origin: (0,0,0)\nencoding: raw\n\n`
    ),
    data,
  ]);
}

async function openHollowCube() {
  const parent = new Uint8Array(SIZE ** 3);
  const mask = new Uint8Array(SIZE ** 3);
  for (let k = 0; k < SIZE; k++) {
    for (let j = 0; j < SIZE; j++) {
      for (let i = 0; i < SIZE; i++) {
        const offset = i + SIZE * (j + SIZE * k);
        parent[offset] = i + j + k;
        const inside = [i, j, k].every((v) => v >= 8 && v <= 55);
        const hole = [i, j, k].every((v) => v >= 13 && v <= 50);
        mask[offset] = Number(inside && !hole);
      }
    }
  }
  fs.writeFileSync(path.join(TEMP_DIR, 'preview-parent.nrrd'), nrrd(parent));
  const zip = new JSZip();
  zip.file('mask.nrrd', nrrd(mask));
  zip.file(
    'manifest.json',
    JSON.stringify({
      version: '7.0.0',
      dataSources: [{ id: 0, type: 'uri', uri: '/tmp/preview-parent.nrrd' }],
      segments: [{ id: 'cube', name: 'Cube', color: [255, 0, 0, 255] }],
      selectedSegment: 'cube',
      segmentations: [
        {
          id: 'segmentation',
          name: 'Cube',
          parentImage: '0',
          order: ['mask'],
          masks: [
            {
              id: 'mask',
              segmentId: 'cube',
              representations: {
                labelmap: {
                  path: 'mask.nrrd',
                  name: 'Cube',
                  extent: [0, 63, 0, 63, 0, 63],
                },
              },
            },
          ],
        },
      ],
    })
  );
  fs.writeFileSync(
    path.join(TEMP_DIR, 'preview.volview.zip'),
    await zip.generateAsync({ type: 'nodebuffer' })
  );
  await AppPage.open('?urls=[tmp/preview.volview.zip]');
  await AppPage.waitForViews();
  await openAnnotationSegments();
  await waitForSegmentContent('Cube');
  await AppPage.activatePaint();
  const views = await AppPage.getViews2D();
  // A click with the selection tool establishes the slice view without painting.
  await AppPage.selectTool('mdi-cursor-default');
  await views[0].$('canvas').click();
  await AppPage.activatePaint();
}

async function previewFill() {
  await AppPage.processModeButton.waitForClickable();
  await AppPage.processModeButton.click();
  await AppPage.selectFillHolesProcess();
  await AppPage.fillHolesWholeVolumeButton.waitForClickable();
  await AppPage.fillHolesWholeVolumeButton.click();
  await AppPage.processPreviewButton.waitForClickable();
  await AppPage.processPreviewButton.click();
  await AppPage.processApplyButton.waitForClickable();
}

type PreviewChoice = 'original' | 'processed';

const previewCanvasState = () =>
  browser.execute(() =>
    Array.from(
      document.querySelectorAll<HTMLCanvasElement>(
        'div[data-testid~="vtk-two-view"] canvas'
      )
    ).map((canvas) => {
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const context = copy.getContext('2d');
      context?.drawImage(canvas, 0, 0);
      const pixels = context?.getImageData(0, 0, copy.width, copy.height).data;
      if (!pixels) return null;

      const size = Math.min(copy.width, copy.height);
      const centerX = copy.width / 2;
      const centerY = copy.height / 2;
      const samples = Array.from({ length: pixels.length / 4 }, (_, index) => {
        const offset = index * 4;
        const red = pixels[offset];
        const green = pixels[offset + 1];
        const blue = pixels[offset + 2];
        return {
          dx: Math.abs((index % copy.width) - centerX) / size,
          dy: Math.abs(Math.floor(index / copy.width) - centerY) / size,
          visible: pixels[offset + 3] > 0 && red + green + blue > 15,
          overlay: red > green + 35 && red > blue + 35,
        };
      });
      const interior = samples.filter(
        ({ dx, dy }) => dx > 0.07 && dx < 0.16 && dy > 0.07 && dy < 0.16
      );

      return {
        image: canvas.toDataURL(),
        visiblePixels: samples.filter(({ visible }) => visible).length,
        boundaryOverlayPixels: samples.filter(
          ({ dx, dy, overlay }) =>
            overlay &&
            dx > 0.025 &&
            dy > 0.025 &&
            dx < 0.42 &&
            dy < 0.42 &&
            (dx > 0.22 || dy > 0.22)
        ).length,
        interiorOverlayRatio:
          interior.filter(({ overlay }) => overlay).length / interior.length,
      };
    })
  );

async function renderedPreview(choice: PreviewChoice, requireSelection = true) {
  const button =
    choice === 'original'
      ? AppPage.processOriginalButton
      : AppPage.processProcessedButton;
  let state: Awaited<ReturnType<typeof previewCanvasState>> = [];

  await browser.waitUntil(
    async () => {
      state = await previewCanvasState();
      const expectedInterior = choice === 'processed' ? 0.25 : 0.02;
      const interiorMatches = state.every((canvas) =>
        choice === 'processed'
          ? canvas !== null && canvas.interiorOverlayRatio > expectedInterior
          : canvas !== null && canvas.interiorOverlayRatio < expectedInterior
      );
      return (
        (!requireSelection || (await AppPage.isPreviewToggleActive(button))) &&
        state.length > 0 &&
        state.every(
          (canvas) =>
            canvas !== null &&
            canvas.visiblePixels > 100 &&
            canvas.boundaryOverlayPixels > 50
        ) &&
        interiorMatches
      );
    },
    { timeoutMsg: `Expected ${choice} preview pixels and selection` }
  );

  return state.map((canvas) =>
    createHash('sha256')
      .update(canvas?.image ?? '')
      .digest('hex')
  );
}

async function exportedVoxelCount(stem: string) {
  const destination = path.join(TEMP_DIR, `${stem}.seg.nrrd`);
  fs.rmSync(destination, { force: true });
  await AppPage.clickSaveSegmentsButton();
  await AppPage.saveSegmentsFilenameInput.waitForDisplayed();
  await setValueVueInput(AppPage.saveSegmentsFilenameInput, stem);
  await AppPage.saveSegmentsConfirmButton.click();
  await waitForDownload(destination, 40000);
  const file = fs.readFileSync(destination);
  const split = file.indexOf('\n\n');
  const bytes = file.subarray(split + 2);
  const data =
    bytes[0] === 0x1f && bytes[1] === 0x8b ? zlib.gunzipSync(bytes) : bytes;
  return data.reduce((count, value) => count + Number(value !== 0), 0);
}

describe('Segment preview ownership', () => {
  beforeEach(openHollowCube);

  it('exports committed content during a preview and saves the result after Apply', async () => {
    expect(await exportedVoxelCount('before-preview')).toBe(originalCount);
    await previewFill();
    expect(await exportedVoxelCount('during-preview')).toBe(originalCount);
    await expect(AppPage.processApplyButton).not.toBeDisplayed();
    await AppPage.processPreviewButton.waitForClickable();
    await AppPage.processPreviewButton.click();
    await AppPage.processApplyButton.waitForClickable();
    await AppPage.processOriginalButton.click();
    await AppPage.processApplyButton.click();
    expect(await exportedVoxelCount('applied-preview')).toBe(filledCount);
  });

  it('keeps named preview choices idempotent for pointer and keyboard activation', async () => {
    const initial = await renderedPreview('original', false);
    await previewFill();
    const processed = await renderedPreview('processed');
    expect(processed).not.toEqual(initial);

    await AppPage.processProcessedButton.click();
    expect(await renderedPreview('processed')).toEqual(processed);

    await AppPage.processOriginalButton.execute((element) => element.focus());
    await browser.keys('Enter');
    const original = await renderedPreview('original');
    expect(original).toEqual(initial);

    await browser.keys('Enter');
    expect(await renderedPreview('original')).toEqual(original);

    await AppPage.processProcessedButton.click();
    expect(await renderedPreview('processed')).toEqual(processed);
  });

  it('cancels a preview before a brush stroke and preserves the new stroke', async () => {
    await previewFill();
    await AppPage.selectTool('mdi-cursor-default');
    await AppPage.activatePaint();
    const views = await AppPage.getViews2D();
    await AppPage.paintStrokeOnView(views[0]);
    await expect(AppPage.processApplyButton).not.toBeDisplayed();
    const count = await exportedVoxelCount('paint-after-preview');
    expect(count).toBeGreaterThan(originalCount);
    expect(count).toBeLessThan(filledCount);
  });
});
