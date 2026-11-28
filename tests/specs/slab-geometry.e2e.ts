import fs from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect, useReferenceLines } from '../fixtures';
import { CONTENT_VIEWPORT } from '../e2eRun';
import { createNrrdVolume, createVtiVolume } from '../fixtures/oct/volumes';
import {
  waitForTransitions,
  type VolViewPage,
} from '../pageobjects/volview.page';
import { canvasAppearance, CANVAS, type OctUtils } from './octTestUtils';

const SOURCE = '[data-testid~="vtk-two-view"] canvas';
const STEM = 'slab-geometry';
function signedFitVolume(negativeAxis?: 0 | 2) {
  const spacing = [negativeAxis === 0 ? -4 : 4, 1, negativeAxis === 2 ? -1 : 1];
  const direction = [
    negativeAxis === 0 ? 1 : -1,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    negativeAxis === 2 ? 1 : -1,
  ];
  const values = Array.from({ length: 20 * 10 * 10 }, (_, index) => {
    const x = index % 20;
    if (x < 2 || x >= 18) return 255;
    return x === 2 || x === 17 ? 0 : 70;
  });
  return createVtiVolume({
    dimensions: [20, 10, 10],
    spacing,
    direction,
    type: 'UInt8',
    values,
  });
}

async function expectEdgeFiducials(canvas: Locator) {
  await expect
    .poll(
      async () => {
        const samples = await canvas.evaluate((element) => {
          const image = element as HTMLCanvasElement;
          const copy = document.createElement('canvas');
          copy.width = image.width;
          copy.height = image.height;
          const context = copy.getContext('2d')!;
          context.drawImage(image, 0, 0);
          return [0.05, 0.5, 0.95].map((fraction) =>
            Array.from(
              context.getImageData(
                Math.floor(image.width * fraction),
                Math.floor(image.height / 2),
                1,
                1
              ).data
            )
          );
        });
        return samples.every(
          (pixel, index) =>
            pixel[3] === 255 &&
            pixel
              .slice(0, 3)
              .every((channel) =>
                index === 1 ? channel > 20 && channel < 150 : channel > 240
              )
        );
      },
      {
        message:
          'Expected both white image-edge fiducials and the gray center to fit',
      }
    )
    .toBe(true);
}

async function openScene(volview: VolViewPage, oct: OctUtils, name: string) {
  await volview.open(`?urls=[tmp/${STEM}.json,tmp/${STEM}/${name}]`);
  await oct.waitForEnFaceReady();
}

// Below 1280 px the side drawer turns temporary and gains a scrim. Back at full
// width the scrim is still fading out over the views, and a click that lands on
// it closes the drawer instead of reaching the view.
async function restoreViewport(page: Page) {
  await page.setViewportSize(CONTENT_VIEWPORT);
  await expect(page.locator('.v-navigation-drawer__scrim')).not.toBeAttached();
}

async function expectPixels(oct: OctUtils, expected: string) {
  await expect
    .poll(async () => (await oct.enFaceAppearance()).image === expected, {
      message: 'Expected the same fitted slab pixels',
    })
    .toBe(true);
}

async function fittedPixels(oct: OctUtils) {
  await expect
    .poll(async () => {
      const pixels = await Promise.all([
        oct.enFacePixel(4, 4),
        oct.enFacePixel(27, 4),
      ]);
      return pixels.every((pixel) => pixel.every((channel) => channel === 255));
    })
    .toBe(true);
  return (await oct.enFaceAppearance()).image;
}

test.describe('Slab geometry and automatic camera fitting', () => {
  useReferenceLines();

  test.beforeEach(async ({ utils }) => {
    const directory = utils.makeTempDir(STEM);
    fs.writeFileSync(path.join(directory, 'reflected.vti'), signedFitVolume());
    fs.writeFileSync(path.join(directory, 'signed-x.vti'), signedFitVolume(0));
    fs.writeFileSync(path.join(directory, 'signed-z.vti'), signedFitVolume(2));
    fs.writeFileSync(
      path.join(directory, 'wide.nrrd'),
      createNrrdVolume({
        dimensions: [32, 4, 8],
        spacing: [1, 1, 1],
        scalars: Uint16Array.from({ length: 32 * 4 * 8 }, (_, i) =>
          i % 32 < 8 || i % 32 >= 24 ? 200 : 100
        ),
      })
    );
    await utils.writeManifestToFile(
      { layouts: { 'Slab geometry': [['coronal'], ['enface']] } },
      STEM + '.json'
    );
  });

  test('fits signed-spacing equivalents with both edge fiducials after load and reset', async ({
    page,
    volview,
    oct,
  }) => {
    const source = page.locator(SOURCE).first();
    let expectedProjection = '';
    let expectedSource = '';
    for (const name of ['reflected.vti', 'signed-x.vti', 'signed-z.vti']) {
      await openScene(volview, oct, name);
      await oct.setEnFaceWindow(255, 127.5);
      for (const reset of [false, true]) {
        if (reset)
          await page
            .locator('button[data-testid="control-button-Reset Views"]')
            .click();
        await expectEdgeFiducials(page.locator(CANVAS).first());
        await expectEdgeFiducials(source);
        if (expectedProjection) {
          await expectPixels(oct, expectedProjection);
          await expect
            .poll(
              async () =>
                (await canvasAppearance(source)).image === expectedSource,
              { message: 'Expected the same fitted source slice pixels' }
            )
            .toBe(true);
        } else {
          expectedProjection = (await oct.enFaceAppearance()).image;
          expectedSource = (await canvasAppearance(source)).image;
        }
      }
    }
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('keeps automatic fitting through remount, scene restore and later resize', async ({
    page,
    volview,
    oct,
  }) => {
    const canvas = page.locator(CANVAS).first();
    const source = page.locator(SOURCE).first();
    await openScene(volview, oct, 'wide.nrrd');
    await page.locator('[data-testid="enface-reset-camera"]').click();
    await page.setViewportSize({ width: 500, height: 720 });
    await waitForTransitions(canvas);
    const fitted = await fittedPixels(oct);
    await restoreViewport(page);
    await source.dblclick();
    await expect(page.locator(CANVAS)).not.toBeAttached();
    await source.dblclick();
    await oct.waitForEnFaceReady();
    await page.setViewportSize({ width: 500, height: 720 });
    await expectPixels(oct, fitted);

    await restoreViewport(page);
    await waitForTransitions(canvas);
    const saved = await volview.saveSession();
    await volview.open('?urls=[tmp/' + saved + ']');
    await oct.waitForEnFaceReady();
    await page.setViewportSize({ width: 500, height: 720 });
    await expectPixels(oct, fitted);
    expect(await volview.getNotificationsCount()).toBe(0);
  });
});
