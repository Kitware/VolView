import fs from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect, useReferenceLines } from '../fixtures';
import { linearSlabSamples } from './slabSamplingTestUtils';
import { createNrrdVolume } from '../fixtures/oct/volumes';
import type { VolViewPage } from '../pageobjects/volview.page';
import {
  displayedWindow,
  windowedGray,
  CANVAS,
  VIEWER,
  PANEL,
  type OctUtils,
} from './octTestUtils';
import type { Utils } from './utils';

const STEM = 'slab-projection';
const SIZE = [8, 7, 6];
const SPACING = [-0.03, 0.01, 0.06];
const AXES = ['Coronal', 'Axial', 'Sagittal'];
const sourceValue = (x: number, y: number, z: number) =>
  7 * x + 11 * y + 17 * z + (y === 0 ? 100 : y === 6 ? 200 : 0);

const nonlinearSourceValue = (x: number, y: number, z: number) =>
  sourceValue(x, y, z) + (x === 1 ? 80 : 0) + (z === 2 ? 120 : 0);

function referenceProjection(
  axis: number,
  point: number[],
  range: { first: number; last: number },
  valueAt = sourceValue
) {
  const inPlane = [0, 1, 2].filter((candidate) => candidate !== axis);
  const column = Array.from({ length: SIZE[axis] }, (_, depth) => {
    const index = [0, 0, 0];
    index[axis] = depth;
    inPlane.forEach((sourceAxis, component) => {
      index[sourceAxis] = point[component];
    });
    return valueAt(index[0], index[1], index[2]);
  });
  return linearSlabSamples(column, {
    ...range,
    spacing: Math.abs(SPACING[axis]),
    minimumSpacing: Math.min(...SPACING.map(Math.abs)),
  });
}

const createSceneHelpers = ({
  page,
  volview,
  utils,
  oct,
}: {
  page: Page;
  volview: VolViewPage;
  utils: Utils;
  oct: OctUtils;
}) => {
  const viewList = async () =>
    Array.from({ length: await page.locator(VIEWER).count() }, (_, index) =>
      page.locator(VIEWER).nth(index)
    );

  async function openScene(twoProjections = false, nonlinear = false) {
    const values = new Uint16Array(SIZE.reduce((a, b) => a * b));
    for (let z = 0; z < SIZE[2]; z++)
      for (let y = 0; y < SIZE[1]; y++)
        for (let x = 0; x < SIZE[0]; x++)
          values[x + SIZE[0] * (y + SIZE[1] * z)] = nonlinear
            ? nonlinearSourceValue(x, y, z)
            : sourceValue(x, y, z);
    fs.writeFileSync(
      path.join(utils.makeTempDir(STEM), 'source.nrrd'),
      createNrrdVolume({
        scalars: values,
        dimensions: SIZE,
        spacing: SPACING,
        origin: [19, -25, 7],
        direction: [0, 1, 0, 0, 0, 1, 1, 0, 0],
      })
    );
    await utils.writeManifestToFile(
      {
        layouts: {
          'Independent projections': twoProjections
            ? [['axial'], ['enface', 'enface']]
            : [['enface']],
        },
      },
      STEM + '.json'
    );
    await volview.open(
      '?urls=[tmp/' + STEM + '.json,tmp/' + STEM + '/source.nrrd]'
    );
    await expect(page.locator(VIEWER).first()).toBeVisible();
    const views = await viewList();
    for (const view of views) await oct.waitForEnFaceReady(view);
    return views;
  }

  async function openControls(view: Locator) {
    await page.keyboard.press('Escape');
    await oct.openEnFaceProjection(view);
  }

  async function magnifyProjection(view: Locator) {
    const canvas = view.locator(CANVAS);
    await page.locator('button[data-testid^="control-button-Zoom "]').click();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('The projection canvas is not on screen');
    for (let step = 0; step < 3; step++)
      await oct.dragContrast(canvas, 0, -Math.round(box.height * 0.3));
    await utils.moveToElement(page.locator('header'));
  }

  async function expectAutomaticWindow(
    view: Locator,
    expected: { width: number; level: number }
  ) {
    const actual = await oct.getEnFaceWindow(view);
    expect(actual.width).toBeCloseTo(expected.width, 6);
    expect(actual.level).toBeCloseTo(expected.level, 6);
  }

  async function saveAndReopen() {
    const saved = await volview.saveSession();
    await volview.open('?urls=[tmp/' + saved + ']');
    await expect(page.locator(VIEWER)).toHaveCount(2);
    return viewList();
  }

  async function expectGray(
    view: Locator,
    point: number[],
    value: number,
    contrast = { width: 2048, level: 1024 }
  ) {
    const expected = windowedGray(value, contrast);
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(255);
    await oct.expectEnFacePixel(expected, point, view);
  }

  async function snapshot(view: Locator) {
    return {
      contrast: await oct.getEnFaceWindow(view),
      transform: await oct.projectionTransform(view),
      image: (await oct.enFaceAppearance(view)).image,
    };
  }

  async function expectSnapshot(
    view: Locator,
    expected: Awaited<ReturnType<typeof snapshot>>
  ) {
    await oct.waitForEnFaceReady(view);
    expect(await oct.getEnFaceWindow(view)).toEqual(expected.contrast);
    await oct.expectProjectionTransform(expected.transform, view);
    await expect
      .poll(async () => (await oct.enFaceAppearance(view)).image)
      .toBe(expected.image);
  }

  async function expectSourceAndPeerUnchanged(
    sourceContrast: Awaited<ReturnType<typeof displayedWindow>>,
    peer: Locator,
    expected: Awaited<ReturnType<typeof snapshot>>
  ) {
    expect(
      await displayedWindow(
        page.locator('div[data-testid~="vtk-two-view"]').first()
      )
    ).toEqual(sourceContrast);
    await expectSnapshot(peer, expected);
    await page.locator('button[data-testid="module-tab-Data"]').click();
    await expect(page.locator('.image-list-card')).toHaveCount(1);
    expect(await volview.getNotificationsCount()).toBe(0);
  }

  const openTwoProjectionViews = async () => {
    const views = await openScene(true);
    expect(views.length).toBe(2);
    return views;
  };

  return {
    openScene,
    openTwoProjectionViews,
    openControls,
    magnifyProjection,
    expectAutomaticWindow,
    saveAndReopen,
    expectGray,
    snapshot,
    expectSnapshot,
    expectSourceAndPeerUnchanged,
  };
};

test.describe('Generic slab projection contracts', () => {
  test.use({ viewport: { width: 1920, height: 1440 } });
  useReferenceLines();

  for (const axis of [0, 1, 2]) {
    test(`uses physical slab sampling and source pixel aspect on axis ${axis}`, async ({
      page,
      volview,
      utils,
      oct,
    }) => {
      const scene = createSceneHelpers({ page, volview, utils, oct });
      const [view] = await scene.openScene(false, true);
      await oct.chooseEnFaceProjection(
        'enface-projection-axis',
        AXES[axis],
        view
      );
      await scene.magnifyProjection(view);
      const inPlane = [0, 1, 2].filter((candidate) => candidate !== axis);
      const points = [
        inPlane.map((index) => Math.floor((SIZE[index] - 1) / 2)),
        inPlane.map((index) => Math.ceil((SIZE[index] - 1) / 2)),
      ];
      const sampling = await view
        .locator('[data-testid="enface-slice-lines"] g')
        .first()
        .evaluate((element) => {
          const matrix = (element as unknown as SVGGElement).getScreenCTM()!;
          const x = Math.hypot(matrix.a, matrix.b);
          const y = Math.hypot(matrix.c, matrix.d);
          return { x, y, aspect: x / y };
        });
      // Magnification keeps framebuffer rounding away from neighboring voxel centers.
      expect(sampling.x).toBeGreaterThan(100);
      expect(sampling.y).toBeGreaterThan(100);
      expect(sampling.aspect).toBeCloseTo(
        Math.abs(SPACING[inPlane[0]] / SPACING[inPlane[1]]),
        5
      );
      const framing = await oct.projectionTransform(view);
      const slabs = [
        [0, 0],
        [0, 1],
        [1, 3],
        [0, 3],
        [0, SIZE[axis] - 1],
      ];
      for (const method of ['Mean', 'Maximum', 'Sum']) {
        const cases = slabs.map(([first, last]) => ({
          first,
          last,
          expectedValues: points.map((point) => {
            const values = referenceProjection(
              axis,
              point,
              { first, last },
              nonlinearSourceValue
            );
            const sum = values.reduce((total, value) => total + value, 0);
            return method === 'Sum'
              ? sum
              : method === 'Mean'
                ? sum / values.length
                : Math.max(...values);
          }),
        }));
        const allExpected = cases.flatMap(
          ({ expectedValues }) => expectedValues
        );
        const minimum = Math.min(...allExpected);
        const maximum = Math.max(...allExpected);
        const margin = Math.max(1, (maximum - minimum) / 8);
        const contrast = {
          width: maximum - minimum + 2 * margin,
          level: (minimum + maximum) / 2,
        };
        await oct.chooseEnFaceProjection(
          'enface-projection-method',
          method,
          view
        );
        await oct.setEnFaceWindow(contrast.width, contrast.level, view);
        await scene.openControls(view);
        for (const { first, last, expectedValues } of cases) {
          await oct.setSlabRange(first, last);
          await oct.waitForEnFaceReady(view);
          for (const [index, point] of points.entries()) {
            const gray =
              ((expectedValues[index] - contrast.level) / contrast.width +
                0.5) *
              255;
            expect(gray).toBeGreaterThan(1);
            expect(gray).toBeLessThan(254);
            await scene.expectGray(
              view,
              point,
              expectedValues[index],
              contrast
            );
          }
          expect(await oct.projectionTransform(view)).toEqual(framing);
        }
        await page.keyboard.press('Escape');
      }
      expect(await volview.getNotificationsCount()).toBe(0);
    });
  }

  test('restores independent slab controls for two views of one source', async ({
    page,
    volview,
    utils,
    oct,
  }) => {
    const scene = createSceneHelpers({ page, volview, utils, oct });
    const views = await scene.openTwoProjectionViews();
    const configurations = [
      {
        axis: 0,
        method: 'Maximum',
        first: 1,
        last: 5,
        width: 340,
        level: 216,
      },
      { axis: 2, method: 'Sum', first: 2, last: 4, width: 5000, level: 2500 },
    ];
    for (const [index, view] of views.entries()) {
      const setting = configurations[index];
      await oct.chooseEnFaceProjection(
        'enface-projection-axis',
        AXES[setting.axis],
        view
      );
      await oct.chooseEnFaceProjection(
        'enface-projection-method',
        setting.method,
        view
      );
      await scene.openControls(view);
      await oct.setSlabRange(setting.first, setting.last);
      await page.keyboard.press('Escape');
      await oct.setEnFaceWindow(setting.width, setting.level, view);
    }
    const expected = [];
    for (const [index, view] of views.entries()) {
      const setting = configurations[index];
      const point = [2, 2];
      const values = referenceProjection(setting.axis, point, {
        first: setting.first,
        last: setting.last,
      });
      const value =
        setting.method === 'Maximum'
          ? Math.max(...values)
          : values.reduce((total, scalar) => total + scalar, 0);
      await scene.expectGray(view, point, value, setting);
      expected.push(await scene.snapshot(view));
    }
    const source = page.locator('div[data-testid~="vtk-two-view"]').first();
    const sourceContrast = await displayedWindow(source);
    const restored = await scene.saveAndReopen();
    for (const [index, view] of restored.entries()) {
      await scene.expectSnapshot(view, expected[index]);
      await scene.openControls(view);
      const setting = configurations[index];
      await expect(
        page
          .locator(PANEL)
          .locator('[data-testid="enface-projection-axis"] input')
      ).toHaveValue(AXES[setting.axis]);
      await expect(
        page
          .locator(PANEL)
          .locator('[data-testid="enface-projection-method"] input')
      ).toHaveValue(setting.method);
      await expect(oct.slabThumb('start')).toHaveAttribute(
        'aria-valuenow',
        String(setting.first)
      );
      await expect(oct.slabThumb('end')).toHaveAttribute(
        'aria-valuenow',
        String(setting.last)
      );
      await page.keyboard.press('Escape');
    }
    await oct.chooseEnFaceProjection(
      'enface-projection-method',
      'Mean',
      restored[0]
    );
    await scene.expectSourceAndPeerUnchanged(
      sourceContrast,
      restored[1],
      expected[1]
    );
  });

  test('restores independent manual contrast and cameras beside their source', async ({
    page,
    volview,
    utils,
    oct,
  }) => {
    const scene = createSceneHelpers({ page, volview, utils, oct });
    const views = await scene.openTwoProjectionViews();
    const configurations = [
      { axis: 0, width: 512, level: 190 },
      { axis: 2, width: 1024, level: 390 },
    ];
    const expected = [];
    for (const [index, view] of views.entries()) {
      const setting = configurations[index];
      await oct.chooseEnFaceProjection(
        'enface-projection-axis',
        AXES[setting.axis],
        view
      );
      await oct.setEnFaceWindow(setting.width, setting.level, view);
      await view.locator(CANVAS).click();
      await page.locator('button[data-testid^="control-button-Pan "]').click();
      await oct.dragContrast(view.locator(CANVAS), 12 + index * 8, 9);
      await page.locator('button[data-testid^="control-button-Zoom "]').click();
      await oct.dragContrast(view.locator(CANVAS), 0, -15 - index * 10);
      const point = [2, 2];
      const values = referenceProjection(setting.axis, point, {
        first: 0,
        last: SIZE[setting.axis] - 1,
      });
      const mean =
        values.reduce((sum, value) => sum + value, 0) / values.length;
      await scene.expectGray(view, point, mean, setting);
      expected.push(await scene.snapshot(view));
    }
    const sourceContrast = await displayedWindow(
      page.locator('div[data-testid~="vtk-two-view"]').first()
    );
    const restored = await scene.saveAndReopen();
    for (const [index, view] of restored.entries())
      await scene.expectSnapshot(view, expected[index]);
    await oct.setEnFaceWindow(600, 200, restored[0]);
    await scene.expectSourceAndPeerUnchanged(
      sourceContrast,
      restored[1],
      expected[1]
    );
  });

  test('uses projected automatic ranges and preserves saved Auto presets beside a manual pane', async ({
    page,
    volview,
    utils,
    oct,
  }) => {
    const scene = createSceneHelpers({ page, volview, utils, oct });
    const [automatic, manual] = await scene.openScene(true);
    // One-percent tails retain both endpoints of this 48-pixel projection.
    await scene.expectAutomaticWindow(automatic, {
      width: 134,
      level: 1750 / 13,
    });
    await oct.setEnFaceWindow(350, 175, manual);
    const unchanged = await scene.snapshot(manual);
    await oct.chooseEnFaceProjection(
      'enface-projection-method',
      'Maximum',
      automatic
    );
    await scene.expectAutomaticWindow(automatic, {
      width: 134,
      level: 333,
    });
    await oct.chooseEnFaceProjection(
      'enface-projection-method',
      'Sum',
      automatic
    );
    await scene.expectAutomaticWindow(automatic, {
      width: 1742,
      level: 1750,
    });
    await scene.openControls(automatic);
    await oct.setSlabRange(1, 3);
    await page.keyboard.press('Escape');
    await oct.waitForEnFaceReady(automatic);
    await scene.expectAutomaticWindow(automatic, {
      width: 670,
      level: 445,
    });
    await scene.expectSnapshot(manual, unchanged);
    const savedAutomatic = await scene.snapshot(automatic);
    const restored = await scene.saveAndReopen();
    await scene.expectSnapshot(restored[0], savedAutomatic);
    await scene.expectSnapshot(restored[1], unchanged);
    await oct.chooseEnFaceProjection(
      'enface-projection-method',
      'Mean',
      restored[0]
    );
    await scene.expectAutomaticWindow(restored[0], {
      width: 134,
      level: 89,
    });
    await scene.expectSnapshot(restored[1], unchanged);
    await restored[0].locator(CANVAS).click();
    await page
      .locator('button[data-testid^="control-button-Window & Level "]')
      .click();
    const fullRange = page.locator(
      '.v-menu.v-overlay--active .v-radio:has(input[value="FullRange"])'
    );
    await fullRange.locator('.v-selection-control__input').click();
    await expect(fullRange.locator('input')).toBeChecked();
    await page.keyboard.press('Escape');
    expect(await oct.getEnFaceWindow(restored[0])).toEqual({
      width: 389,
      level: 205.5,
    });
    const savedFull = await scene.snapshot(restored[0]);
    const fullRestored = await scene.saveAndReopen();
    await scene.expectSnapshot(fullRestored[0], savedFull);
    await scene.expectSnapshot(fullRestored[1], unchanged);
    await oct.setEnFaceWindow(600, 200, fullRestored[0]);
    await oct.chooseEnFaceProjection(
      'enface-projection-method',
      'Sum',
      fullRestored[0]
    );
    await scene.expectAutomaticWindow(fullRestored[0], {
      width: 670,
      level: 445,
    });
    await scene.expectSnapshot(fullRestored[1], unchanged);
    expect(await volview.getNotificationsCount()).toBe(0);
  });
});
