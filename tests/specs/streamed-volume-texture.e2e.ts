import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { CONTENT_VIEWPORT } from '../e2eRun';
import type { VolViewPage } from '../pageobjects/volview.page';
import {
  buildSyntheticCineDicom,
  buildSyntheticDicom,
  newUid,
} from './syntheticDicom';
import type { Utils } from './utils';
import { displayedWindow, WINDOW_TOOL } from './octTestUtils';
import { VIEW } from './volumeTestUtils';

const [COLS, ROWS, SLICES] = [24, 20, 32];
const FULL_WIDTH = 4000;
const TWO_VIEW = 'div[data-testid="vtk-view vtk-two-view"]';
const MULTIFRAME_GRAYSCALE_BYTE = '1.2.840.10008.5.1.4.1.1.7.2';

// The end slices each hold under 5% of the voxels, so High Contrast drops them.
const sliceValue = (index: number) => {
  if (index === 0) return 0;
  return index === SLICES - 1 ? FULL_WIDTH : 1000 + 10 * index;
};

const series = (modality: string) => {
  const [studyUid, seriesUid] = [newUid(), newUid()];
  return Array.from({ length: SLICES }, (_, index): [string, Uint8Array] => [
    `slice-${index}.dcm`,
    buildSyntheticDicom({
      studyUid,
      seriesUid,
      sopUid: newUid(),
      modality,
      instanceNumber: index + 1,
      rows: ROWS,
      cols: COLS,
      imageOrientationPatient: [1, 0, 0, 0, 1, 0],
      imagePositionPatient: [0, 0, index],
      pixelValue: sliceValue(index),
    }),
  ]);
};

async function open(
  page: Page,
  volview: VolViewPage,
  utils: Utils,
  name: string,
  files: [string, Uint8Array][]
) {
  const directory = utils.makeTempDir(name);
  const resources = files.map(([file, dicom]) => {
    fs.writeFileSync(path.join(directory, file), dicom);
    return { url: `tmp/${name}/${file}`, name: file };
  });
  await utils.writeManifestToFile({ resources }, `${name}.json`);
  await utils.openVolViewPage(`${name}.json`);
  await volview.waitForViewCounts(3, true);
  await volview.waitForLoadingIndicator(page.locator(TWO_VIEW).first());
}

/** High Contrast narrows the window once the presets have their fit too. */
async function waitForStatistics(page: Page, volview: VolViewPage) {
  const view = page.locator(TWO_VIEW).first();
  await view.locator('canvas').click();
  const windowTool = page.locator(WINDOW_TOOL);
  const menu = await volview.openMenu(windowTool);
  await menu
    .locator(
      '.v-radio:has(input[value="HighContrast"]) .v-selection-control__input'
    )
    .click();
  await volview.closeMenu(windowTool);
  await expect
    .poll(async () => (await displayedWindow(view)).width, {
      message: 'Expected the image statistics to narrow the window',
    })
    .toBeLessThan(FULL_WIDTH / 2);
}

const canvasWidth = (page: Page) =>
  page
    .locator(VIEW)
    .locator('canvas')
    .evaluate((canvas) => (canvas as HTMLCanvasElement).width);

/** A resize redraws the 3D view at once, after every earlier change. */
async function redraw3D(page: Page) {
  const width = await canvasWidth(page);
  await page.setViewportSize({
    ...CONTENT_VIEWPORT,
    width: CONTENT_VIEWPORT.width - 100,
  });
  await expect.poll(() => canvasWidth(page)).not.toBe(width);
}

/** Share of the 3D view's rows that show any of the volume. */
async function volumeHeight(utils: Utils) {
  const [{ width, data }] = await utils.captureViewPixels(
    VIEW,
    60,
    'volume.png'
  );
  const rows = data.length / 4 / width;
  const filled = Array.from({ length: rows }, (_, row) =>
    data
      .subarray(row * width * 4, (row + 1) * width * 4)
      .some((value, index) => index % 4 !== 3 && value > 40)
  );
  return filled.filter(Boolean).length / rows;
}

test.describe('streamed volume textures', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((size) => {
      const gl = WebGL2RenderingContext.prototype as unknown as Record<
        string,
        (...args: unknown[]) => unknown
      >;
      let count = 0;
      Object.assign(window, { volumeAllocations: () => count });
      ['texImage3D', 'texStorage3D'].forEach((name) => {
        const allocate = gl[name];
        gl[name] = function record(this: unknown, ...args: unknown[]) {
          if (args.slice(3, 6).join('x') === size) count += 1;
          return allocate.apply(this, args);
        };
      });
    }, `${COLS}x${ROWS}x${SLICES}`);
  });

  ['CT', 'MR'].forEach((modality) => {
    test(`uploads a ${modality} series once through loading and its preset fit`, async ({
      page,
      volview,
      utils,
    }) => {
      await open(
        page,
        volview,
        utils,
        `streamed-${modality}`,
        series(modality)
      );
      await waitForStatistics(page, volview);
      await redraw3D(page);
      const allocations = await page.evaluate(() =>
        (
          window as unknown as { volumeAllocations: () => number }
        ).volumeAllocations()
      );
      expect(allocations).toBe(1);
    });
  });

  test('shows every frame of a multi-frame file in 3D', async ({
    page,
    volview,
    utils,
  }) => {
    const dicom = buildSyntheticCineDicom({
      studyUid: newUid(),
      seriesUid: newUid(),
      sopUid: newUid(),
      numberOfFrames: 16,
      rows: ROWS,
      cols: COLS,
      sopClassUid: MULTIFRAME_GRAYSCALE_BYTE,
    });
    await open(page, volview, utils, 'streamed-frames', [
      ['frames.dcm', dicom],
    ]);
    // One frame alone shows as a thin slab.
    await expect
      .poll(() => volumeHeight(utils), {
        message: 'Expected the 3D view to show every frame',
      })
      .toBeGreaterThan(0.5);
  });
});
