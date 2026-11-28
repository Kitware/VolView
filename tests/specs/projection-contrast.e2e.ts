import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import type { Page } from '@playwright/test';
import { test, expect, useReferenceLines } from '../fixtures';
import type { SlabSamplingUtils } from './slabSamplingTestUtils';
import { CONTENT_VIEWPORT } from '../e2eRun';
import { JHU_RETINAL_LAYERS, MRA_HEAD_NECK_DATASET } from '../datasets';
import { stageProjectionContrastVolume } from './projectionTestUtils';
import { waitForTransitions } from '../pageobjects/volview.page';
import { windowedGray, type OctUtils } from './octTestUtils';

const STEM = 'projection-contrast';

function stageSumContrastControl(
  directory: string,
  name: string,
  spacing: number[]
) {
  const values = Array.from({ length: 20 * 3 * 4 }, (_, index) =>
    index % 20 < 10 ? 100 : 200
  );
  fs.writeFileSync(
    path.join(directory, name + '.vti'),
    '<VTKFile type="ImageData" version="1.0" byte_order="LittleEndian">' +
      `<ImageData WholeExtent="0 19 0 2 0 3" Origin="0 0 0" Spacing="${spacing.join(' ')}">` +
      '<Piece Extent="0 19 0 2 0 3"><PointData Scalars="intensity">' +
      '<DataArray type="Float32" Name="intensity" format="ascii">' +
      values.join(' ') +
      '</DataArray></PointData><CellData/></Piece></ImageData></VTKFile>'
  );
}

async function expectSumPlateaus(oct: OctUtils, low: number, high: number) {
  for (const row of [1, 2]) {
    for (const [column, gray] of [
      [4, low],
      [15, high],
    ]) {
      await oct.expectEnFacePixel(gray, [column, row]);
    }
  }
}

async function expectVisibleContrast(
  slabSampling: SlabSamplingUtils,
  minimumSpread: number
) {
  await expect
    .poll(async () => {
      const { count, low, high } =
        await slabSampling.projectionGrayscaleDistribution();
      return count > 1000 && high >= 160 && high - low >= minimumSpread;
    })
    .toBe(true);
}

async function expectAutomaticRange(
  oct: OctUtils,
  minimum: number,
  maximum: number
) {
  const window = await oct.getEnFaceWindow();
  expect(window.width).toBeGreaterThan(0);
  expect(window.width).toBeLessThanOrEqual(maximum - minimum + 2);
  expect(window.level).toBeGreaterThanOrEqual(minimum);
  expect(window.level).toBeLessThanOrEqual(maximum);
  return window;
}

async function expectAnalyticalPixel(
  oct: OctUtils,
  value: number,
  window: { width: number; level: number }
) {
  await oct.expectEnFacePixel(windowedGray(value, window), [4, 3]);
}

const enFaceImageBounds = (page: Page) =>
  page.evaluate(() => {
    const viewport = document.querySelector('[data-testid="enface-viewer"]');
    if (!viewport) throw new Error('The En face image viewport is missing');
    const { left, top, width, height } = viewport.getBoundingClientRect();
    return { left, top, width, height };
  });

test.describe('Projection default contrast', () => {
  useReferenceLines();

  test.beforeEach(async ({ utils, scratch }) => {
    await utils.useCachedSample(MRA_HEAD_NECK_DATASET);
    await utils.useCachedSample(JHU_RETINAL_LAYERS);
    await utils.writeManifestToFile(
      { layouts: { Projection: [['enface']] } },
      `${STEM}.json`
    );
    const directory = utils.makeTempDir(STEM);
    stageProjectionContrastVolume(directory);
    stageSumContrastControl(directory, 'decimal-sum', [0.01, 0.01, 0.06]);
    stageSumContrastControl(directory, 'exact-sum', [0.125, 0.125, 0.75]);
    const retinal = await JSZip.loadAsync(
      fs.readFileSync(scratch.path(JHU_RETINAL_LAYERS.name))
    );
    fs.writeFileSync(
      path.join(directory, 'retinal-source.nrrd'),
      await retinal.file('jhu-hc01.nrrd')!.async('nodebuffer')
    );
    await utils.writeManifestToFile(
      {
        layouts: {
          Four: [
            ['axial', 'sagittal'],
            ['coronal', 'enface'],
          ],
        },
      },
      `${STEM}-four.json`
    );
  });

  test('opens the MRA sample Mean projection with visible grayscale contrast', async ({
    volview,
    oct,
    slabSampling,
  }) => {
    await volview.open(`?urls=[tmp/${STEM}.json]`);
    await volview.samplesList.locator('div[title="MRA Head and Neck"]').click();
    await oct.waitForEnFaceReady();
    await expectVisibleContrast(slabSampling, 80);
  });

  test('opens the non-DICOM retinal Mean projection with visible grayscale contrast', async ({
    page,
    volview,
    oct,
    segmentation,
    slabSampling,
  }) => {
    await volview.open(`?urls=[tmp/${STEM}.json]`);
    await volview.samplesList
      .locator('div[title="Retinal OCT layers"]')
      .click();
    await oct.waitForEnFaceReady();
    // The sample's layers would tint the projection this test measures.
    await segmentation.openAnnotationSegments();
    const everySegment = page.locator(
      '[data-testid="toggle-segments-visible-button"]'
    );
    await expect(everySegment).toBeEnabled();
    await everySegment.click();
    await expect(everySegment).toHaveAttribute(
      'aria-label',
      'Show every segment on this image'
    );
    await oct.waitForEnFaceReady();
    await expectVisibleContrast(slabSampling, 35);
  });

  for (const manual of [false, true]) {
    test(`preserves ${manual ? 'manual' : 'automatic'} retinal contrast while maximizing and restoring`, async ({
      page,
      volview,
      oct,
      slabSampling,
    }) => {
      // Keep the desktop layout while bounding software projection rendering.
      await page.setViewportSize({ ...CONTENT_VIEWPORT, height: 400 });
      await volview.open(
        `?urls=[tmp/${STEM}-four.json,tmp/${STEM}/retinal-source.nrrd]`
      );
      await volview.waitForViews();
      await oct.waitForEnFaceReady();
      await expectVisibleContrast(slabSampling, 35);
      if (manual) await oct.setEnFaceWindow(25.5, 40.8);
      const initialWindow = await oct.getEnFaceWindow();
      const initialSize = await enFaceImageBounds(page);
      const distribution = await slabSampling.projectionGrayscaleDistribution();
      const initialSpread = distribution.high - distribution.low;

      for (const viewCount of [1, 4]) {
        await waitForTransitions(
          page.locator('[data-testid="enface-canvas"]').first()
        );
        const bounds = await enFaceImageBounds(page);
        const point = {
          x: Math.round(bounds.left + bounds.width * 0.5),
          y: Math.round(bounds.top + bounds.height * 0.5),
        };
        await expect
          .poll(
            () =>
              page.evaluate(
                ({ x, y }) =>
                  !!document
                    .elementFromPoint(x, y)
                    ?.closest('[data-testid="enface-viewer"]'),
                point
              ),
            {
              message: 'The visible En face image must receive pointer input',
            }
          )
          .toBe(true);
        const viewport = page.locator('[data-testid="enface-viewer"]').first();
        await expect(viewport).toBeVisible();
        await expect(viewport).toBeEnabled();
        // Native click counts keep the gesture independent of rendering delays.
        await page.mouse.dblclick(point.x, point.y);
        await expect
          .poll(
            async () => {
              const size = await enFaceImageBounds(page);
              return viewCount === 1
                ? size.width > initialSize.width * 1.5 &&
                    size.height > initialSize.height * 1.5
                : Math.abs(size.width - initialSize.width) <= 2 &&
                    Math.abs(size.height - initialSize.height) <= 2;
            },
            {
              message:
                'Double-click must maximize and restore the En face image',
            }
          )
          .toBe(true);
        await oct.waitForEnFaceReady();
        const renderedSize = await enFaceImageBounds(page);
        if (viewCount === 1) {
          expect(renderedSize.width).toBeGreaterThan(initialSize.width * 1.5);
          expect(renderedSize.height).toBeGreaterThan(initialSize.height * 1.5);
        } else {
          expect(
            Math.abs(renderedSize.width - initialSize.width)
          ).toBeLessThanOrEqual(2);
          expect(
            Math.abs(renderedSize.height - initialSize.height)
          ).toBeLessThanOrEqual(2);
        }
        const actualWindow = await oct.getEnFaceWindow();
        expect(actualWindow).toEqual(initialWindow);
        await expect
          .poll(
            async () => {
              const { count, low, high } =
                await slabSampling.projectionGrayscaleDistribution();
              return count > 1000 && high - low >= initialSpread - 8;
            },
            {
              message:
                'Maximizing and restoring must retain the retinal grayscale spread',
            }
          )
          .toBe(true);
      }
      expect(await volview.getNotificationsCount()).toBe(0);
    });
  }

  test('keeps decimal Sum automatic contrast aligned with an exact-spacing control', async ({
    volview,
    oct,
  }) => {
    for (const name of ['decimal-sum', 'exact-sum']) {
      await volview.open(`?urls=[tmp/${STEM}.json,tmp/${STEM}/${name}.vti]`);
      await oct.waitForEnFaceReady();
      await oct.chooseEnFaceProjection('enface-projection-method', 'Sum');
      await oct.waitForEnFaceReady();
      // Five samples of each constant-depth ray produce sums 500 and 1000.
      expect(await oct.getEnFaceWindow()).toEqual({ width: 500, level: 750 });
      await expectSumPlateaus(oct, 0, 255);
      await oct.setEnFaceWindow(1500, 750);
      await expectSumPlateaus(oct, 85, 170);
    }
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('follows projection and slab changes in Auto and preserves saved manual contrast', async ({
    volview,
    oct,
  }) => {
    await volview.open(`?urls=[tmp/${STEM}.json,tmp/${STEM}/source.nrrd]`);
    await oct.waitForEnFaceReady();
    await expectAnalyticalPixel(
      oct,
      1551 / 9,
      await expectAutomaticRange(oct, 1110 / 9, 1875 / 9)
    );
    await oct.chooseEnFaceProjection('enface-projection-method', 'Maximum');
    await oct.waitForEnFaceReady();
    await expectAnalyticalPixel(
      oct,
      549,
      await expectAutomaticRange(oct, 500, 585)
    );
    await oct.chooseEnFaceProjection('enface-projection-method', 'Sum');
    await oct.waitForEnFaceReady();
    await expectAnalyticalPixel(
      oct,
      1551,
      await expectAutomaticRange(oct, 1110, 1875)
    );
    await oct.chooseEnFaceProjection('enface-projection-method', 'Mean');
    await oct.setEnFaceSlab(1, 3);
    await oct.waitForEnFaceReady();
    await expectAnalyticalPixel(
      oct,
      89,
      await expectAutomaticRange(oct, 40, 125)
    );

    const manual = { width: 160, level: 80 };
    await oct.setEnFaceWindow(manual.width, manual.level);
    await oct.chooseEnFaceProjection('enface-projection-method', 'Maximum');
    await oct.waitForEnFaceReady();
    const automatic = { width: 85, level: 102.5 };
    expect(await oct.getEnFaceWindow()).toEqual(automatic);
    await expectAnalyticalPixel(oct, 109, automatic);
    await oct.setEnFaceWindow(manual.width, manual.level);
    await oct.setEnFaceSlab(2, 4);
    await oct.waitForEnFaceReady();
    expect(await oct.getEnFaceWindow()).toEqual(manual);
    await expectAnalyticalPixel(oct, 129, manual);
    const saved = await volview.saveSession();
    await volview.open(`?urls=[tmp/${saved}]`);
    await oct.waitForEnFaceReady();
    expect(await oct.getEnFaceWindow()).toEqual(manual);
    await expectAnalyticalPixel(oct, 129, manual);
    expect(await volview.getNotificationsCount()).toBe(0);
  });
});
