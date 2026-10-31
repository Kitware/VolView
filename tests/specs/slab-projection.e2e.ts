import fs from 'node:fs';
import path from 'node:path';
import { setReferenceLinesEnabled } from './referenceLinesTestUtils';
import { linearSlabSamples } from './slabSamplingTestUtils';
import { createNrrdVolume } from '../fixtures/oct/volumes';
import { CONTENT_VIEWPORT, TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import {
  chooseEnFaceProjection,
  displayedWindow,
  dragContrast,
  enFaceAppearance,
  enFacePixel,
  expandEnFaceSection,
  getEnFaceWindow,
  projectionTransform,
  setSlabRange,
  setEnFaceWindow,
  slabThumb,
  waitForEnFaceReady,
  CANVAS,
  VIEWER,
  PANEL,
} from './octTestUtils';
import {
  makeTempDir,
  SESSION_SAVE_TIMEOUT,
  waitForDownload,
  writeManifestToFile,
} from './utils';

const STEM = 'slab-projection';
const SIZE = [8, 7, 6];
const SPACING = [-0.03, 0.01, 0.06];
const AXES = ['Coronal', 'Axial', 'Sagittal'];
const sourceValue = (x: number, y: number, z: number) =>
  7 * x + 11 * y + 17 * z + (y === 0 ? 100 : y === 6 ? 200 : 0);

async function openScene(twoProjections = false) {
  const values = new Uint16Array(SIZE.reduce((a, b) => a * b));
  for (let z = 0; z < SIZE[2]; z++)
    for (let y = 0; y < SIZE[1]; y++)
      for (let x = 0; x < SIZE[0]; x++)
        values[x + SIZE[0] * (y + SIZE[1] * z)] = sourceValue(x, y, z);
  fs.writeFileSync(
    path.join(makeTempDir(STEM), 'source.nrrd'),
    createNrrdVolume({
      scalars: values,
      dimensions: SIZE,
      spacing: SPACING,
      origin: [19, -25, 7],
      direction: [0, 1, 0, 0, 0, 1, 1, 0, 0],
    })
  );
  await writeManifestToFile(
    {
      layouts: {
        'Independent projections': twoProjections
          ? [['axial'], ['enface', 'enface']]
          : [['enface']],
      },
    },
    STEM + '.json'
  );
  await volViewPage.open(
    '?urls=[tmp/' + STEM + '.json,tmp/' + STEM + '/source.nrrd]'
  );
  await $(VIEWER).waitForDisplayed();
  const views = await $$(VIEWER).map((view) => view.getElement());
  for (const view of views) await waitForEnFaceReady(view);
  return views;
}

async function openControls(view: WebdriverIO.Element) {
  await browser.keys('Escape');
  await view.$('[data-testid="enface-controls"]').click();
  await $(PANEL).waitForDisplayed();
  await expandEnFaceSection('projection');
}

async function setWindow(
  view: WebdriverIO.Element,
  width: number,
  level: number
) {
  await setEnFaceWindow(width, level, view);
}

async function magnifyProjection(view: WebdriverIO.Element) {
  const canvas = await view.$(CANVAS).getElement();
  await $('button[data-testid^="control-button-Zoom "]').click();
  const height = await canvas.getSize('height');
  for (let step = 0; step < 3; step++)
    await dragContrast(canvas, 0, -Math.round(height * 0.3), { duration: 0 });
  await $('header').moveTo();
}

async function expectAutomaticWindow(
  view: WebdriverIO.Element,
  expected: { width: number; level: number }
) {
  const actual = await getEnFaceWindow(view);
  expect(actual.width).toBeCloseTo(expected.width, 6);
  expect(actual.level).toBeCloseTo(expected.level, 6);
}

async function saveAndReopen() {
  const saved = await volViewPage.saveSession();
  await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
  await volViewPage.open('?urls=[tmp/' + saved + ']');
  await browser.waitUntil(async () => (await $$(VIEWER).length) === 2);
  return $$(VIEWER).map((view) => view.getElement());
}

async function expectGray(
  view: WebdriverIO.Element,
  point: number[],
  value: number,
  contrast = { width: 2048, level: 1024 }
) {
  const expected = Math.round(
    255 *
      Math.max(0, Math.min(1, (value - contrast.level) / contrast.width + 0.5))
  );
  let observed: number[] = [];
  await browser.waitUntil(
    async () => {
      observed = await enFacePixel(point[0], point[1], { x: 0, y: 0 }, view);
      return (
        observed[3] === 255 &&
        observed
          .slice(0, 3)
          .every((channel) => Math.abs(channel - expected) <= 1)
      );
    },
    {
      timeoutMsg: `Expected (${point}) value ${value}, grayscale ${expected}; observed ${observed}`,
    }
  );
}

function referenceProjection(
  axis: number,
  point: number[],
  first: number,
  last: number
) {
  const inPlane = [0, 1, 2].filter((candidate) => candidate !== axis);
  const column = Array.from({ length: SIZE[axis] }, (_, depth) => {
    const index = [0, 0, 0];
    index[axis] = depth;
    inPlane.forEach((sourceAxis, component) => {
      index[sourceAxis] = point[component];
    });
    return sourceValue(index[0], index[1], index[2]);
  });
  return linearSlabSamples(column, {
    first,
    last,
    spacing: Math.abs(SPACING[axis]),
    minimumSpacing: Math.min(...SPACING.map(Math.abs)),
  });
}

async function snapshot(view: WebdriverIO.Element) {
  return {
    contrast: await getEnFaceWindow(view),
    transform: await projectionTransform(view),
    image: (await enFaceAppearance(view)).image,
  };
}

async function expectSnapshot(
  view: WebdriverIO.Element,
  expected: Awaited<ReturnType<typeof snapshot>>
) {
  await waitForEnFaceReady(view);
  expect(await getEnFaceWindow(view)).toEqual(expected.contrast);
  await browser.waitUntil(async () =>
    (await projectionTransform(view)).every(
      (value, index) => Math.abs(value - expected.transform[index]) < 1e-4
    )
  );
  await browser.waitUntil(
    async () => (await enFaceAppearance(view)).image === expected.image
  );
}

async function expectSourceAndPeerUnchanged(
  sourceContrast: Awaited<ReturnType<typeof displayedWindow>>,
  peer: WebdriverIO.Element,
  expected: Awaited<ReturnType<typeof snapshot>>
) {
  expect(
    await displayedWindow(
      await $('div[data-testid~="vtk-two-view"]').getElement()
    )
  ).toEqual(sourceContrast);
  await expectSnapshot(peer, expected);
  await $('button[data-testid="module-tab-Data"]').click();
  expect(await $$('.image-list-card').length).toBe(1);
  expect(await volViewPage.getNotificationsCount()).toBe(0);
}

describe('Generic slab projection contracts', () => {
  before(async () => {
    await volViewPage.open();
    await browser.setViewport({
      width: 1920,
      height: 1440,
      devicePixelRatio: 1,
    });
    await setReferenceLinesEnabled(true);
  });
  after(async () => {
    await setReferenceLinesEnabled(false);
    await browser.setViewport({ ...CONTENT_VIEWPORT, devicePixelRatio: 1 });
  });

  for (const axis of [0, 1, 2]) {
    it(`uses physical slab sampling and source pixel aspect on axis ${axis}`, async () => {
      const [view] = await openScene();
      await chooseEnFaceProjection('enface-projection-axis', AXES[axis], view);
      await magnifyProjection(view);
      const inPlane = [0, 1, 2].filter((candidate) => candidate !== axis);
      const points = [
        inPlane.map((index) => Math.floor((SIZE[index] - 1) / 2)),
        inPlane.map((index) => Math.ceil((SIZE[index] - 1) / 2)),
      ];
      const frame = await view
        .$('[data-testid="enface-slice-lines"] g')
        .getElement();
      const sampling = await frame.execute((element) => {
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
      const framing = await projectionTransform(view);
      for (const method of ['Mean', 'Maximum', 'Sum']) {
        await chooseEnFaceProjection('enface-projection-method', method, view);
        await setWindow(view, 2048, 1024);
        await openControls(view);
        for (const [first, last] of [
          [0, 0],
          [0, 1],
          [1, 3],
          [0, 3],
          [0, SIZE[axis] - 1],
        ]) {
          await setSlabRange(first, last);
          await waitForEnFaceReady(view);
          for (const point of points) {
            const values = referenceProjection(axis, point, first, last);
            const sum = values.reduce((total, value) => total + value, 0);
            const expected =
              method === 'Sum'
                ? sum
                : method === 'Mean'
                  ? sum / values.length
                  : Math.max(...values);
            await expectGray(view, point, expected);
          }
          expect(await projectionTransform(view)).toEqual(framing);
        }
        await browser.keys('Escape');
      }
      expect(await volViewPage.getNotificationsCount()).toBe(0);
    });
  }

  it('restores independent slab controls for two views of one source', async () => {
    const views = await openScene(true);
    expect(views.length).toBe(2);
    const configurations = [
      {
        axis: 0,
        method: 'Maximum',
        first: 1,
        last: 5,
        width: 340,
        level: 216,
      },
      { axis: 2, method: 'Sum', first: 2, last: 4, width: 912, level: 642 },
    ];
    for (const [index, view] of views.entries()) {
      const setting = configurations[index];
      await chooseEnFaceProjection(
        'enface-projection-axis',
        AXES[setting.axis],
        view
      );
      await chooseEnFaceProjection(
        'enface-projection-method',
        setting.method,
        view
      );
      await openControls(view);
      await setSlabRange(setting.first, setting.last);
      await browser.keys('Escape');
      await setWindow(view, setting.width, setting.level);
    }
    const expected = [];
    for (const [index, view] of views.entries()) {
      const setting = configurations[index];
      const point = [2, 2];
      const values = referenceProjection(
        setting.axis,
        point,
        setting.first,
        setting.last
      );
      const value =
        setting.method === 'Maximum'
          ? Math.max(...values)
          : values.reduce((total, scalar) => total + scalar, 0);
      await expectGray(view, point, value, setting);
      expected.push(await snapshot(view));
    }
    const source = await $('div[data-testid~="vtk-two-view"]').getElement();
    const sourceContrast = await displayedWindow(source);
    const restored = await saveAndReopen();
    for (const [index, view] of restored.entries()) {
      await expectSnapshot(view, expected[index]);
      await openControls(view);
      const setting = configurations[index];
      await expect(
        $(PANEL).$('[data-testid="enface-projection-axis"] input')
      ).toHaveValue(AXES[setting.axis]);
      await expect(
        $(PANEL).$('[data-testid="enface-projection-method"] input')
      ).toHaveValue(setting.method);
      await expect(slabThumb('start')).toHaveAttribute(
        'aria-valuenow',
        String(setting.first)
      );
      await expect(slabThumb('end')).toHaveAttribute(
        'aria-valuenow',
        String(setting.last)
      );
      await browser.keys('Escape');
    }
    await chooseEnFaceProjection(
      'enface-projection-method',
      'Mean',
      restored[0]
    );
    await expectSourceAndPeerUnchanged(
      sourceContrast,
      restored[1],
      expected[1]
    );
  });

  it('restores independent manual contrast and cameras beside their source', async () => {
    const views = await openScene(true);
    expect(views.length).toBe(2);
    const configurations = [
      { axis: 0, width: 512, level: 190 },
      { axis: 2, width: 1024, level: 390 },
    ];
    const expected = [];
    for (const [index, view] of views.entries()) {
      const setting = configurations[index];
      await chooseEnFaceProjection(
        'enface-projection-axis',
        AXES[setting.axis],
        view
      );
      await setWindow(view, setting.width, setting.level);
      await view.$(CANVAS).click();
      await $('button[data-testid^="control-button-Pan "]').click();
      await dragContrast(await view.$(CANVAS).getElement(), 12 + index * 8, 9);
      await $('button[data-testid^="control-button-Zoom "]').click();
      await dragContrast(
        await view.$(CANVAS).getElement(),
        0,
        -15 - index * 10
      );
      const point = [2, 2];
      const values = referenceProjection(
        setting.axis,
        point,
        0,
        SIZE[setting.axis] - 1
      );
      const mean =
        values.reduce((sum, value) => sum + value, 0) / values.length;
      await expectGray(view, point, mean, setting);
      expected.push(await snapshot(view));
    }
    const sourceContrast = await displayedWindow(
      await $('div[data-testid~="vtk-two-view"]').getElement()
    );
    const restored = await saveAndReopen();
    for (const [index, view] of restored.entries())
      await expectSnapshot(view, expected[index]);
    await setWindow(restored[0], 600, 200);
    await expectSourceAndPeerUnchanged(
      sourceContrast,
      restored[1],
      expected[1]
    );
  });

  it('uses projected automatic ranges and preserves saved Auto presets beside a manual pane', async () => {
    const [automatic, manual] = await openScene(true);
    // One-percent tails retain both endpoints of this 48-pixel projection.
    await expectAutomaticWindow(automatic, {
      width: 134,
      level: 1750 / 13,
    });
    await setWindow(manual, 350, 175);
    const unchanged = await snapshot(manual);
    await chooseEnFaceProjection(
      'enface-projection-method',
      'Maximum',
      automatic
    );
    await expectAutomaticWindow(automatic, {
      width: 134,
      level: 333,
    });
    await chooseEnFaceProjection('enface-projection-method', 'Sum', automatic);
    await expectAutomaticWindow(automatic, {
      width: 1742,
      level: 1750,
    });
    await openControls(automatic);
    await setSlabRange(1, 3);
    await browser.keys('Escape');
    await waitForEnFaceReady(automatic);
    await expectAutomaticWindow(automatic, {
      width: 670,
      level: 445,
    });
    await expectSnapshot(manual, unchanged);
    const savedAutomatic = await snapshot(automatic);
    const restored = await saveAndReopen();
    await expectSnapshot(restored[0], savedAutomatic);
    await expectSnapshot(restored[1], unchanged);
    await chooseEnFaceProjection(
      'enface-projection-method',
      'Mean',
      restored[0]
    );
    await expectAutomaticWindow(restored[0], {
      width: 134,
      level: 89,
    });
    await expectSnapshot(restored[1], unchanged);
    await restored[0].$(CANVAS).click();
    await $('button[data-testid^="control-button-Window & Level "]').click();
    const fullRange = $(
      '.v-menu.v-overlay--active .v-radio:has(input[value="FullRange"])'
    );
    const radio = fullRange.$('.v-selection-control__input');
    await radio.scrollIntoView({ block: 'center', inline: 'nearest' });
    await radio.waitForStable();
    await radio.waitForClickable();
    await radio.click();
    await expect(fullRange.$('input')).toBeChecked();
    await browser.keys('Escape');
    expect(await getEnFaceWindow(restored[0])).toEqual({
      width: 389,
      level: 205.5,
    });
    const savedFull = await snapshot(restored[0]);
    const fullRestored = await saveAndReopen();
    await expectSnapshot(fullRestored[0], savedFull);
    await expectSnapshot(fullRestored[1], unchanged);
    await setWindow(fullRestored[0], 600, 200);
    await chooseEnFaceProjection(
      'enface-projection-method',
      'Sum',
      fullRestored[0]
    );
    await expectAutomaticWindow(fullRestored[0], {
      width: 670,
      level: 445,
    });
    await expectSnapshot(fullRestored[1], unchanged);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });
});
