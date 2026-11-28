import fs from 'node:fs';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  setValueVueInput,
  type VolViewPage,
} from '../pageobjects/volview.page';
import type { SaveDownload, Scratch } from '../scratch';
import type { SegmentationUtils } from './segmentationTestUtils';

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

async function openHollowCube({
  scratch,
  volview,
  segmentation,
}: {
  scratch: Scratch;
  volview: VolViewPage;
  segmentation: SegmentationUtils;
}) {
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
  scratch.writeFile('preview-parent.nrrd', nrrd(parent));
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
  scratch.writeFile(
    'preview.volview.zip',
    await zip.generateAsync({ type: 'nodebuffer' })
  );
  await volview.open('?urls=[tmp/preview.volview.zip]');
  await volview.waitForViews();
  await segmentation.openAnnotationSegments();
  await segmentation.waitForSegmentContent('Cube');
  await volview.activatePaint();
  // A click with the selection tool establishes the slice view without painting.
  await volview.selectTool('mdi-cursor-default');
  await volview.views2D.first().locator('canvas').click();
  await volview.activatePaint();
}

const expectClickable = async (button: Locator) => {
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
};

async function previewFill(volview: VolViewPage) {
  await volview.processModeButton.click();
  await volview.selectFillHolesProcess();
  await volview.fillHolesWholeVolumeButton.click();
  await volview.processPreviewButton.click();
  await expectClickable(volview.processApplyButton);
}

type PreviewChoice = 'original' | 'processed';

const previewCanvasState = (page: Page) =>
  page.evaluate(() =>
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

async function renderedPreview(
  { page, volview }: { page: Page; volview: VolViewPage },
  choice: PreviewChoice,
  requireSelection = true
) {
  const button =
    choice === 'original'
      ? volview.processOriginalButton
      : volview.processProcessedButton;
  let state: Awaited<ReturnType<typeof previewCanvasState>> = [];

  await expect
    .poll(
      async () => {
        state = await previewCanvasState(page);
        const expectedInterior = choice === 'processed' ? 0.25 : 0.02;
        const interiorMatches = state.every((canvas) =>
          choice === 'processed'
            ? canvas !== null && canvas.interiorOverlayRatio > expectedInterior
            : canvas !== null && canvas.interiorOverlayRatio < expectedInterior
        );
        return (
          (!requireSelection ||
            (await volview.isPreviewToggleActive(button))) &&
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
      { message: `Expected ${choice} preview pixels and selection` }
    )
    .toBe(true);

  return state.map((canvas) =>
    createHash('sha256')
      .update(canvas?.image ?? '')
      .digest('hex')
  );
}

async function exportedVoxelCount(
  {
    volview,
    saveDownload,
  }: { volview: VolViewPage; saveDownload: SaveDownload },
  stem: string
) {
  await volview.clickSaveSegmentsButton();
  await expect(volview.saveSegmentsFilenameInput).toBeVisible();
  await setValueVueInput(volview.saveSegmentsFilenameInput, stem);
  const destination = await saveDownload(() =>
    volview.saveSegmentsConfirmButton.click()
  );
  const file = fs.readFileSync(destination);
  const split = file.indexOf('\n\n');
  const bytes = file.subarray(split + 2);
  const data =
    bytes[0] === 0x1f && bytes[1] === 0x8b ? zlib.gunzipSync(bytes) : bytes;
  return data.reduce((count, value) => count + Number(value !== 0), 0);
}

test.describe('Segment preview ownership', () => {
  test.beforeEach(({ scratch, volview, segmentation }) =>
    openHollowCube({ scratch, volview, segmentation })
  );

  test('exports committed content during a preview and saves the result after Apply', async ({
    volview,
    saveDownload,
  }) => {
    const download = { volview, saveDownload };
    expect(await exportedVoxelCount(download, 'before-preview')).toBe(
      originalCount
    );
    await previewFill(volview);
    expect(await exportedVoxelCount(download, 'during-preview')).toBe(
      originalCount
    );
    await expect(volview.processApplyButton).toBeHidden();
    await volview.processPreviewButton.click();
    await expectClickable(volview.processApplyButton);
    await volview.processOriginalButton.click();
    await volview.processApplyButton.click();
    expect(await exportedVoxelCount(download, 'applied-preview')).toBe(
      filledCount
    );
  });

  test('keeps named preview choices idempotent for pointer and keyboard activation', async ({
    page,
    volview,
  }) => {
    const viewed = { page, volview };
    const initial = await renderedPreview(viewed, 'original', false);
    await previewFill(volview);
    const processed = await renderedPreview(viewed, 'processed');
    expect(processed).not.toEqual(initial);

    await volview.processProcessedButton.click();
    expect(await renderedPreview(viewed, 'processed')).toEqual(processed);

    await volview.processOriginalButton.focus();
    await page.keyboard.press('Enter');
    const original = await renderedPreview(viewed, 'original');
    expect(original).toEqual(initial);

    await page.keyboard.press('Enter');
    expect(await renderedPreview(viewed, 'original')).toEqual(original);

    await volview.processProcessedButton.click();
    expect(await renderedPreview(viewed, 'processed')).toEqual(processed);
  });

  test('cancels a preview before a brush stroke and preserves the new stroke', async ({
    volview,
    saveDownload,
  }) => {
    await previewFill(volview);
    await volview.selectTool('mdi-cursor-default');
    await volview.activatePaint();
    await volview.paintStrokeOnView(volview.views2D.first());
    await expect(volview.processApplyButton).toBeHidden();
    const count = await exportedVoxelCount(
      { volview, saveDownload },
      'paint-after-preview'
    );
    expect(count).toBeGreaterThan(originalCount);
    expect(count).toBeLessThan(filledCount);
  });
});
