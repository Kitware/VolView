import fs from 'node:fs';
import path from 'node:path';
import { Key } from 'webdriverio';
import { setReferenceLinesEnabled } from './referenceLinesTestUtils';
import { createNrrdVolume } from '../fixtures/oct/volumes';
import { volViewPage } from '../pageobjects/volview.page';
import {
  chooseEnFaceProjection,
  dragContrast,
  expandEnFaceSection,
  projectionTransform,
  setEnFaceWindow,
  setSlabRange,
  slabThumb,
  waitForEnFaceReady,
  CANVAS,
} from './octTestUtils';
import {
  makeTempDir,
  waitForModuleTransitions,
  writeManifestToFile,
} from './utils';

const STEM = 'slab-crosshairs';
const VIEW = '[data-testid="enface-viewer"]';
const SOURCE = 'crosshairs-source.nrrd';
const OTHER = 'crosshairs-other.nrrd';
const SIZE = [16, 12, 10];
// The source's cyclic rotation maps index X/Y/Z to Coronal/Axial/Sagittal.
const ORIENTATIONS = ['Coronal', 'Axial', 'Sagittal'];

async function scene(otherImage = false) {
  const directory = makeTempDir(STEM);
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
  await writeManifestToFile(
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
  await volViewPage.open('?urls=[' + names.map((name) => 'tmp/' + name) + ']');
  await waitForEnFaceReady();
  await setReferenceLinesEnabled(true);
  await browser.waitUntil(async () => Object.keys(await slices()).length === 3);
}

const tool = (name: string) =>
  $('button[data-testid^="control-button-' + name + ' "]');

function slices() {
  return browser.execute(() =>
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

async function point(x: number, y: number) {
  return browser.execute(
    (imageX, imageY) => {
      const matrix = document
        .querySelector<SVGGElement>('[data-testid="enface-slice-lines"] g')!
        .getScreenCTM()!;
      const screen = new DOMPoint(imageX + 0.5, imageY + 0.5).matrixTransform(
        matrix
      );
      return { x: Math.round(screen.x), y: Math.round(screen.y) };
    },
    x,
    y
  );
}

async function pick(x: number, y: number, dragFrom?: number[]) {
  const target = await point(x, y);
  const start = dragFrom ? await point(dragFrom[0], dragFrom[1]) : target;
  await browser
    .action('pointer', { id: 'slab-crosshair-pick' })
    .move(start)
    .down()
    .move(target)
    .up()
    .perform();
}

async function expectSlices(expected: Record<string, number | null>) {
  await browser.waitUntil(
    async () => JSON.stringify(await slices()) === JSON.stringify(expected),
    { timeoutMsg: 'Expected source slice labels to follow the projection pick' }
  );
}

async function controls() {
  await $(VIEW).$('[data-testid="enface-controls"]').click();
  await expandEnFaceSection('projection');
}

function gapWidths() {
  return browser.execute(() => {
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

async function expectGap() {
  await browser.waitUntil(
    async () => {
      const gaps = await gapWidths();
      return (
        gaps.length === 2 && gaps.every((width) => Math.abs(width - 16) < 0.5)
      );
    },
    {
      timeoutMsg:
        'Expected a 16 CSS-pixel gap at both reference-line crossings',
    }
  );
}

describe('Crosshairs in slab projections', () => {
  after(async () => setReferenceLinesEnabled(false));
  for (const axis of [0, 1, 2]) {
    it(
      'picks and drags source coordinates without changing depth on axis ' +
        axis,
      async () => {
        await scene();
        await chooseEnFaceProjection(
          'enface-projection-axis',
          ORIENTATIONS[axis]
        );
        await controls();
        const last = 4;
        await setSlabRange(1, last);
        await browser.keys('Escape');
        await waitForEnFaceReady();
        const before = await slices();
        const framing = await projectionTransform();
        await $(VIEW).click();
        await expect(tool('Crosshairs')).toBeEnabled();
        await tool('Crosshairs').click();
        const inPlane = ORIENTATIONS.filter((_, index) => index !== axis);
        const expected = { ...before, [inPlane[0]]: 2, [inPlane[1]]: 3 };
        await pick(2, 3);
        await expectSlices(expected);
        await pick(4, 2, [2, 3]);
        await expectSlices({ ...before, [inPlane[0]]: 4, [inPlane[1]]: 2 });
        expect(await projectionTransform()).toEqual(framing);
        await controls();
        await expect(slabThumb('start')).toHaveAttribute('aria-valuenow', '1');
        await expect(slabThumb('end')).toHaveAttribute(
          'aria-valuenow',
          String(last)
        );
        await browser.keys('Escape');
      }
    );
  }

  it('keeps the ordinary screen-space crossing gap during navigation and resize', async () => {
    await scene();
    await expectGap();
    await $(VIEW).click();
    await tool('Crosshairs').click();
    await $(
      '.vtk-container-wrapper [data-testid="reference-lines"] line'
    ).waitForExist();
    const strokes = await browser.execute(() =>
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
    const sourceSlices = await slices();
    for (const [name, dx, dy] of [
      ['Zoom', 0, -35],
      ['Pan', 18, 12],
    ] as const) {
      const before = await projectionTransform();
      await tool(name).click();
      await dragContrast(await $(CANVAS).getElement(), dx, dy);
      await browser.waitUntil(async () =>
        (await projectionTransform()).some(
          (value, index) => Math.abs(value - before[index]) > 0.1
        )
      );
      await expectGap();
      await expectSlices(sourceSlices);
    }
    const beforeResize = await projectionTransform();
    try {
      await browser.setViewport({
        width: 1000,
        height: 800,
        devicePixelRatio: 2,
      });
      await browser.waitUntil(async () =>
        (await projectionTransform()).some(
          (value, index) => Math.abs(value - beforeResize[index]) > 0.1
        )
      );
      await expectGap();
      await tool('Crosshairs').click();
      await pick(3, 4);
      await expectSlices({ ...sourceSlices, Coronal: 3, Sagittal: 4 });
    } finally {
      await browser.setViewport({
        width: 1280,
        height: 720,
        devicePixelRatio: 1,
      });
    }
  });

  it('temporarily navigates the source while leaving another image unchanged', async () => {
    await scene(true);
    await $('button[data-testid="module-tab-Data"]').click();
    await waitForModuleTransitions();
    const sourceCard = $('.image-list-card:has([title="' + SOURCE + '"])');
    const menu = sourceCard.$('[data-testid="dataset-menu-button"]');
    await menu.waitForStable();
    await menu.waitForClickable();
    await menu.click();
    const showAll = $('.v-list-item*=Show in all views');
    await showAll.waitForDisplayed();
    await showAll.waitForStable();
    await showAll.waitForClickable();
    await showAll.click();
    await expect($(VIEW)).toHaveText(expect.stringContaining(SOURCE));
    await waitForEnFaceReady();
    const coronal = await (await $$('.vtk-container-wrapper'))[1].getElement();
    await expect(coronal.$('.view-type-select input')).toHaveValue('Coronal');
    await coronal.$('canvas').click();
    await $('.image-list-card:has([title="' + OTHER + '"])').click();
    await expect(coronal).toHaveText(expect.stringContaining(OTHER));
    const before = await slices();
    await $(VIEW).click();
    await volViewPage.renderingModuleTab.click();
    await waitForModuleTransitions();
    await $('[data-testid="base-image-visibility"]').click();
    await setEnFaceWindow(600, 300, await $(VIEW).getElement());
    await expect($(VIEW)).toHaveAttribute('aria-busy', 'false');
    await tool('Pan').click();
    const keyboard = () => browser.action('key', { id: 'slab-crosshair-hold' });
    try {
      await keyboard().down(Key.Shift).down('c').perform(true);
      await expect(tool('Crosshairs')).toHaveElementClass('tool-btn-selected');
      await browser
        .action('pointer')
        .move(await point(3, 2))
        .perform(true);
      await expectSlices({ ...before, Sagittal: 2 });
      await expect(tool('Crosshairs')).toHaveElementClass('tool-btn-selected');
      await keyboard().up('c').up(Key.Shift).perform(true);
      await expect(tool('Pan')).toHaveElementClass('tool-btn-selected');
    } finally {
      await browser.releaseActions();
    }
  });
});
