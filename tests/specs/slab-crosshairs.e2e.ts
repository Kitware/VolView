import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { createNrrdVolume } from '../fixtures/oct/volumes';
import { containsText } from '../pageobjects/volview.page';
import type { VolViewPage } from '../pageobjects/volview.page';
import type { ReferenceLinesUtils } from './referenceLinesTestUtils';
import { CANVAS, type OctUtils } from './octTestUtils';
import type { Utils } from './utils';

const STEM = 'slab-crosshairs';
const VIEW = '[data-testid="enface-viewer"]';
const SOURCE = 'crosshairs-source.nrrd';
const OTHER = 'crosshairs-other.nrrd';
const SIZE = [16, 12, 10];
// The source's cyclic rotation maps index X/Y/Z to Coronal/Axial/Sagittal.
const ORIENTATIONS = ['Coronal', 'Axial', 'Sagittal'];
const SELECTED = /\btool-btn-selected\b/;

type Helpers = {
  page: Page;
  volview: VolViewPage;
  utils: Utils;
  oct: OctUtils;
};

async function scene(
  { page, volview, utils, oct }: Helpers,
  referenceLines: ReferenceLinesUtils,
  otherImage = false
) {
  const directory = utils.makeTempDir(STEM);
  for (const name of otherImage ? [SOURCE, OTHER] : [SOURCE]) {
    fs.writeFileSync(
      path.join(directory, name),
      createNrrdVolume({
        dimensions: SIZE,
        spacing: [0.4, 0.7, 1.1],
        origin: [19, -25, name === SOURCE ? 7 : 40],
        direction: [0, 1, 0, 0, 0, 1, 1, 0, 0],
        scalars: Uint16Array.from(
          { length: SIZE.reduce((total, size) => total * size) },
          (_, index) => 20 + (index % 400)
        ),
      })
    );
  }
  await utils.writeManifestToFile(
    {
      layouts: {
        Crosshairs: [
          ['axial', 'coronal'],
          ['sagittal', 'enface'],
        ],
      },
    },
    STEM + '.json'
  );
  const names = [STEM + '.json', STEM + '/' + SOURCE];
  if (otherImage) names.push(STEM + '/' + OTHER);
  await volview.open('?urls=[' + names.map((name) => 'tmp/' + name) + ']');
  await oct.waitForEnFaceReady();
  await referenceLines.setReferenceLinesEnabled(true);
  await expect.poll(async () => Object.keys(await slices(page)).length).toBe(3);
}

function slices(page: Page) {
  return page.evaluate(() =>
    Object.fromEntries(
      Array.from(document.querySelectorAll('.vtk-container-wrapper')).flatMap(
        (view) => {
          const orientation = view.querySelector<HTMLInputElement>(
            '.view-type-select input'
          )?.value;
          const slice = view.textContent?.match(/Slice:\s*(\d+)/);
          return orientation && slice
            ? [[orientation, Number(slice[1]) - 1]]
            : [];
        }
      )
    )
  );
}

async function point(oct: OctUtils, x: number, y: number) {
  const screen = await oct.enFaceScreenPoint(x + 0.5, y + 0.5);
  return { x: Math.round(screen.x), y: Math.round(screen.y) };
}

async function pick(
  { page, oct }: Helpers,
  x: number,
  y: number,
  dragFrom?: number[]
) {
  const target = await point(oct, x, y);
  const start = dragFrom ? await point(oct, dragFrom[0], dragFrom[1]) : target;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y);
  await page.mouse.up();
}

async function expectSlices(
  page: Page,
  expected: Record<string, number | null>
) {
  await expect
    .poll(
      async () =>
        JSON.stringify(await slices(page)) === JSON.stringify(expected),
      {
        message: 'Expected source slice labels to follow the projection pick',
      }
    )
    .toBe(true);
}

function gapWidths(page: Page) {
  return page.evaluate(() => {
    const svg = document.querySelector(
      '[data-testid="enface-viewer"] [data-testid="reference-lines"]'
    );
    if (!svg) return [];
    const segments = Array.from(svg.querySelectorAll('line')).map((line) => {
      const matrix = line.getScreenCTM()!;
      return [
        new DOMPoint(
          line.x1.baseVal.value,
          line.y1.baseVal.value
        ).matrixTransform(matrix),
        new DOMPoint(
          line.x2.baseVal.value,
          line.y2.baseVal.value
        ).matrixTransform(matrix),
      ];
    });
    return [0, 1].flatMap((axis) => {
      const intervals = segments
        .filter(([a, b]) =>
          axis === 0 ? Math.abs(a.y - b.y) < 0.1 : Math.abs(a.x - b.x) < 0.1
        )
        .map(([a, b]) =>
          [axis === 0 ? a.x : a.y, axis === 0 ? b.x : b.y].sort(
            (first, second) => first - second
          )
        )
        .sort((a, b) => a[0] - b[0]);
      return intervals.length === 2 ? [intervals[1][0] - intervals[0][1]] : [];
    });
  });
}

async function expectGap(page: Page) {
  await expect
    .poll(
      async () => {
        const gaps = await gapWidths(page);
        return (
          gaps.length === 2 && gaps.every((width) => Math.abs(width - 16) < 0.5)
        );
      },
      {
        message: 'Expected a 16 CSS-pixel gap at both reference-line crossings',
      }
    )
    .toBe(true);
}

test.describe('Crosshairs in slab projections', () => {
  for (const axis of [0, 1, 2]) {
    test(
      'picks and drags source coordinates without changing depth on axis ' +
        axis,
      async ({ page, volview, utils, oct, referenceLines }) => {
        const helpers = { page, volview, utils, oct };
        await scene(helpers, referenceLines);
        await oct.chooseEnFaceProjection(
          'enface-projection-axis',
          ORIENTATIONS[axis]
        );
        const last = 4;
        await oct.setEnFaceSlab(1, last);
        await oct.waitForEnFaceReady();
        const before = await slices(page);
        const framing = await oct.projectionTransform();
        await page.locator(VIEW).click();
        await expect(oct.toolButton('Crosshairs')).toBeEnabled();
        await oct.toolButton('Crosshairs').click();
        const inPlane = ORIENTATIONS.filter((_, index) => index !== axis);
        const expected = { ...before, [inPlane[0]]: 2, [inPlane[1]]: 3 };
        await pick(helpers, 2, 3);
        await expectSlices(page, expected);
        await pick(helpers, 4, 2, [2, 3]);
        await expectSlices(page, {
          ...before,
          [inPlane[0]]: 4,
          [inPlane[1]]: 2,
        });
        expect(await oct.projectionTransform()).toEqual(framing);
        await oct.openEnFaceProjection();
        await expect(oct.slabThumb('start')).toHaveAttribute(
          'aria-valuenow',
          '1'
        );
        await expect(oct.slabThumb('end')).toHaveAttribute(
          'aria-valuenow',
          String(last)
        );
        await page.keyboard.press('Escape');
      }
    );
  }

  test('keeps the ordinary screen-space crossing gap during navigation and resize', async ({
    page,
    volview,
    utils,
    oct,
    referenceLines,
  }) => {
    const helpers = { page, volview, utils, oct };
    await scene(helpers, referenceLines);
    await expectGap(page);
    await page.locator(VIEW).click();
    await oct.toolButton('Crosshairs').click();
    await expect(
      page
        .locator('.vtk-container-wrapper [data-testid="reference-lines"] line')
        .first()
    ).toBeAttached();
    const strokes = await page.evaluate(() =>
      [
        document.querySelector(
          '.vtk-container-wrapper [data-testid="reference-lines"] line'
        ),
        document.querySelector(
          '[data-testid="enface-viewer"] [data-testid="reference-lines"] line'
        ),
      ].map(
        (line) =>
          line && [
            getComputedStyle(line).stroke,
            getComputedStyle(line).strokeWidth,
          ]
      )
    );
    expect(strokes[1]).toEqual(strokes[0]);
    const sourceSlices = await slices(page);
    for (const [name, dx, dy] of [
      ['Zoom', 0, -35],
      ['Pan', 18, 12],
    ] as const) {
      const before = await oct.projectionTransform();
      await oct.toolButton(name).click();
      await oct.dragContrast(page.locator(CANVAS).first(), dx, dy);
      await expect
        .poll(async () =>
          (await oct.projectionTransform()).some(
            (value, index) => Math.abs(value - before[index]) > 0.1
          )
        )
        .toBe(true);
      await expectGap(page);
      await expectSlices(page, sourceSlices);
    }
    const beforeResize = await oct.projectionTransform();
    // Playwright sets the device scale only per context, so change it in place.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1000,
      height: 800,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await expect
      .poll(async () =>
        (await oct.projectionTransform()).some(
          (value, index) => Math.abs(value - beforeResize[index]) > 0.1
        )
      )
      .toBe(true);
    await expectGap(page);
    await oct.toolButton('Crosshairs').click();
    await pick(helpers, 3, 4);
    await expectSlices(page, { ...sourceSlices, Coronal: 3, Sagittal: 4 });
  });

  test('temporarily navigates the source while leaving another image unchanged', async ({
    page,
    volview,
    utils,
    oct,
    referenceLines,
  }) => {
    await scene({ page, volview, utils, oct }, referenceLines, true);
    await page.locator('button[data-testid="module-tab-Data"]').click();
    await utils.waitForModuleTransitions();
    const sourceCard = page.locator(
      '.image-list-card:has([title="' + SOURCE + '"])'
    );
    await sourceCard.locator('[data-testid="dataset-menu-button"]').click();
    await page
      .locator('.v-list-item', { hasText: containsText('Show in all views') })
      .click();
    await expect(page.locator(VIEW)).toContainText(SOURCE);
    await oct.waitForEnFaceReady();
    const coronal = page.locator('.vtk-container-wrapper').nth(1);
    await expect(coronal.locator('.view-type-select input')).toHaveValue(
      'Coronal'
    );
    await coronal.locator('canvas').first().click();
    await page.locator('.image-list-card:has([title="' + OTHER + '"])').click();
    await expect(coronal).toContainText(OTHER);
    const before = await slices(page);
    await page.locator(VIEW).click();
    await volview.renderingModuleTab.click();
    await utils.waitForModuleTransitions();
    await page.locator('[data-testid="base-image-visibility"]').click();
    await oct.setEnFaceWindow(600, 300, page.locator(VIEW));
    await expect(page.locator(VIEW)).toHaveAttribute('aria-busy', 'false');
    await oct.toolButton('Pan').click();
    // Playwright does not shift a letter, so the shifted key is named.
    await page.keyboard.down('Shift');
    await page.keyboard.down('C');
    await expect(oct.toolButton('Crosshairs')).toHaveClass(SELECTED);
    const target = await point(oct, 3, 2);
    await page.mouse.move(target.x, target.y);
    await expectSlices(page, { ...before, Sagittal: 2 });
    await expect(oct.toolButton('Crosshairs')).toHaveClass(SELECTED);
    await page.keyboard.up('C');
    await page.keyboard.up('Shift');
    await expect(oct.toolButton('Pan')).toHaveClass(SELECTED);
  });
});
