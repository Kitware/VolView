import type { Locator } from '@playwright/test';
import { test, expect } from '../fixtures';
import type { Scratch } from '../scratch';
import { buildSyntheticCineDicom, newUid } from './syntheticDicom';

const ROW_SPACING = 1.8;
const COLUMN_SPACING = 0.45;
const ROWS = 6;
const COLUMNS = 7;
const EDGE_TOLERANCE_PX = 4;

function writeCineDicom(scratch: Scratch) {
  const fileName = `cine-pixel-spacing-${Date.now()}.dcm`;

  scratch.writeFile(
    fileName,
    buildSyntheticCineDicom({
      studyUid: newUid(),
      seriesUid: newUid(),
      sopUid: newUid(),
      numberOfFrames: 4,
      rows: ROWS,
      cols: COLUMNS,
      pixelSpacing: [ROW_SPACING, COLUMN_SPACING],
    })
  );

  return fileName;
}

// Bounds of the lit pixels, in CSS pixels relative to the canvas.
const renderedImageBounds = (canvas: Locator) =>
  canvas.evaluate((element) => {
    const source = element as HTMLCanvasElement;
    const copy = document.createElement('canvas');
    copy.width = source.width;
    copy.height = source.height;
    const context = copy.getContext('2d')!;
    context.drawImage(source, 0, 0);
    const { data } = context.getImageData(0, 0, copy.width, copy.height);
    const lit = { left: Infinity, right: -Infinity, top: Infinity, bottom: -1 };
    for (let y = 0; y < copy.height; y++)
      for (let x = 0; x < copy.width; x++) {
        const index = (y * copy.width + x) * 4;
        if (Math.max(data[index], data[index + 1], data[index + 2]) > 0) {
          lit.left = Math.min(lit.left, x);
          lit.right = Math.max(lit.right, x);
          lit.top = Math.min(lit.top, y);
          lit.bottom = Math.max(lit.bottom, y);
        }
      }
    const bounds = source.getBoundingClientRect();
    const scaleX = bounds.width / copy.width;
    const scaleY = bounds.height / copy.height;
    return {
      width: (lit.right - lit.left + 1) * scaleX,
      height: (lit.bottom - lit.top + 1) * scaleY,
    };
  });

test.describe('Cine DICOM PixelSpacing', () => {
  test('falls back to PixelSpacing when ultrasound regions are unusable', async ({
    page,
    volview,
    utils,
    scratch,
    segmentation,
  }) => {
    const fileName = writeCineDicom(scratch);
    await utils.openFileThroughManifest(
      fileName,
      `cine-pixel-spacing-${Date.now()}.json`
    );
    await volview.waitForViews();

    const canvas = page
      .locator('div[data-testid="vtk-view vtk-cine-view"] canvas')
      .first();
    await expect
      .poll(async () => (await renderedImageBounds(canvas)).width)
      .toBeGreaterThan(0);
    const image = await renderedImageBounds(canvas);

    const box = await canvas.boundingBox();
    if (!box) throw new Error('The cine canvas is not on screen');
    const centerX = Math.round(box.x + box.width / 2);
    const top = Math.round(box.y + box.height * 0.1);
    const bottom = Math.round(box.y + box.height * 0.9);
    await page.locator('button span i[class~=mdi-ruler]').click();
    await page.mouse.click(centerX, top);
    await page.mouse.click(centerX, bottom);

    await segmentation.openSegmentShapes();
    const row = page
      .locator('[data-testid="segment-shape-row"]')
      .filter({ hasText: /[\d.]+\s*mm/ })
      .first();
    await expect(row).toBeVisible();
    const rulerMm = parseFloat(
      (await row.innerText()).match(/([\d.]+)\s*mm/)![1]
    );
    const mmPerPixel = rulerMm / (bottom - top);

    expect(
      Math.abs(image.height - (ROWS * ROW_SPACING) / mmPerPixel)
    ).toBeLessThanOrEqual(EDGE_TOLERANCE_PX);
    expect(
      Math.abs(image.width - (COLUMNS * COLUMN_SPACING) / mmPerPixel)
    ).toBeLessThanOrEqual(EDGE_TOLERANCE_PX);
  });
});
