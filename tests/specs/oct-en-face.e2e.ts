import fs from 'node:fs';
import path from 'node:path';
import {
  stageIllustrativeMask,
  stageGenericOCT,
  ILLUSTRATIVE_THIN_COLUMNS,
  expectStackedSourceMask,
  expectControlsBesideSelector,
  expectEnFacePixels,
  expectEnFaceDisabledInSwitcher,
  readEnFacePixels,
  getEnFaceWindow as getWindow,
} from './octTestUtils';
import { FIXTURES, TEMP_DIR } from '../../wdio.shared.conf';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import {
  makeTempDir,
  openVolViewPage,
  openThroughDialog,
  writeManifestToFile,
  waitForDownload,
  SESSION_SAVE_TIMEOUT,
} from './utils';
import { nonOCTDicom } from '../fixtures/oct/volumes';
import { paddedPublicOCT } from '../fixtures/oct/padding';
import { waitForFirstCachedImageSpacing } from './imageCacheUtils';
import {
  openAnnotationSegments,
  selectSegment,
  waitForSegmentContent,
} from './segmentationTestUtils';

const reference = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, 'oct', 'reference.json'), 'utf8')
) as {
  size: number[];
  spacing: number[];
  range: number[];
  points: { x: number; z: number }[];
  projections: Record<string, number[]>;
  slab: { start: number; end: number; mean: number[] };
  thinColumns: number;
  allSegmentedColumns: number;
  alternateSegmentColumns: number;
};
const CANVAS = '[data-testid="oct-en-face-canvas"]';
const STATE = '[data-testid="oct-en-face-state"]';
const CONTROLS = '[data-testid="oct-en-face-controls"]';
const THRESHOLD = '[data-testid="oct-thickness-threshold-input"] input';
const WINDOW_TOOL = 'button[data-testid^="control-button-Window & Level "]';
const SLICE_LINE = '[data-testid="oct-slice-line"]';
const STEM = 'oct-fixtures';

function stageFixture(name: string) {
  const directory = makeTempDir(STEM);
  fs.copyFileSync(path.join(FIXTURES, 'oct', name), path.join(directory, name));
  return STEM + '/' + name;
}

async function selectEnFace() {
  const switcher = (await $$('.view-type-select .v-field'))[0];
  await switcher.click();
  const option = $(
    '//div[contains(@class, "v-overlay--active")]//div[contains(@class, "v-list-item") and normalize-space(.)="En face"]'
  );
  await option.waitForClickable();
  await option.click();
  await $(CANVAS).waitForDisplayed();
  await browser.waitUntil(
    async () => (await $(CANVAS).getAttribute('width')) === '128',
    {
      timeoutMsg:
        'Expected the real OCT volume to generate a 128-column en face bitmap',
    }
  );
}

async function attachMaskThroughDataPanel(file: string) {
  await openThroughDialog(path.join(TEMP_DIR, file));
  await $('button[data-testid="module-tab-Data"]').click();
  const card = $('.v-card:has([title="' + path.basename(file) + '"])');
  await card.waitForDisplayed();
  await card.$('button.dataset-menu').click();
  const attach = $(
    '//div[contains(@class,"v-overlay--active")]//div[contains(@class,"v-list-item") and normalize-space(.)="Add as segmentation"]'
  );
  await attach.waitForStable();
  await attach.waitForClickable();
  await attach.click();
}

async function openControls() {
  await $(CONTROLS).click();
  const panel = $('[data-testid="oct-rendering-panel"]');
  await panel.waitForDisplayed();
  await panel.waitForStable();
}

async function setNumber(testId: string, value: number) {
  const input = $('[data-testid="' + testId + '"] input');
  await input.scrollIntoView({ block: 'center', inline: 'nearest' });
  await input.waitForClickable();
  await setValueVueInput(input, String(value));
  if (testId.startsWith('oct-slab-'))
    await $('[data-testid="oct-rendering-panel"] .controls-title').click();
}

async function expandAdvanced() {
  const toggle = $('[data-testid="oct-advanced-toggle"]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true')
    await toggle.click();
  await $('[data-testid="oct-projection-axis"]').waitForDisplayed();
  await $('[data-testid="oct-rendering-panel"]').waitForStable();
}

async function selectSetting(testId: string, title: string) {
  const select = $('[data-testid="' + testId + '"]');
  await select.scrollIntoView({ block: 'center', inline: 'nearest' });
  await select.waitForClickable();
  await select.click();
  const option = $(
    '//div[contains(@class, "v-overlay--active")]//div[contains(@class, "v-list-item") and normalize-space(.)="' +
      title +
      '"]'
  );
  await option.waitForClickable();
  await option.click();
}

async function enableHighlight() {
  const label = $('[data-testid="oct-thin-highlight"] label');
  await label.scrollIntoView({ block: 'center', inline: 'nearest' });
  await label.waitForClickable();
  await label.click();
}

async function waitForProjection(method: string) {
  await browser.waitUntil(async () => {
    const state = $(STATE);
    if ((await state.getAttribute('data-state')) === 'error')
      throw new Error(await state.getText());
    return (
      (await state.getAttribute('data-state')) === 'ready' &&
      (await state.getAttribute('data-projection-method')) === method
    );
  });
}

async function canvasPixels(points = reference.points) {
  return readEnFacePixels(points);
}

async function dragEnFaceContrast() {
  await $(CANVAS).click();
  await $(WINDOW_TOOL).waitForClickable();
  if (
    !((await $(WINDOW_TOOL).getAttribute('class')) ?? '').includes(
      'tool-btn-selected'
    )
  )
    await $(WINDOW_TOOL).click();
  const before = await getWindow();
  const location = await $(CANVAS).getLocation();
  const size = await $(CANVAS).getSize();
  const x = Math.round(location.x + size.width / 2);
  const y = Math.round(location.y + size.height / 2);
  await browser
    .action('pointer')
    .move({ x, y })
    .down()
    .move({ x: x + 60, y: y + 40, duration: 300 })
    .up()
    .perform();
  await browser.waitUntil(async () => {
    const after = await getWindow();
    return after.width !== before.width && after.level !== before.level;
  });
}

async function getOriginalWindow() {
  const source = (await volViewPage.getViews2D())[0];
  const match = (await source.getText()).match(
    /W\/L:\s*([\d.]+)\s*\/\s*([\d.]+)/
  );
  if (!match)
    throw new Error('The original B-scan has no window-level annotation');
  return { width: Number(match[1]), level: Number(match[2]) };
}

async function expectProjectedPixels(values: number[]) {
  return expectEnFacePixels(values, reference.points);
}
async function expectHighlightCount(count: number) {
  await browser.waitUntil(
    async () =>
      (await $(STATE).getAttribute('data-highlighted-pixels')) ===
      String(count),
    {
      timeoutMsg:
        'Expected ' + count + ' physically thin A-lines to be highlighted',
    }
  );
}

async function openRetina(withMask = false, comparison = false) {
  const image = stageFixture('retina-derived.dcm');
  await writeManifestToFile(
    {
      layouts: {
        'OCT test': comparison ? [['axial'], ['enface']] : [['axial']],
      },
    },
    'oct-config.json'
  );
  const source = withMask ? 'oct-mask.volview.json' : image;
  if (withMask) {
    const mask = comparison
      ? STEM +
        '/' +
        stageIllustrativeMask(
          makeTempDir(STEM),
          reference.size,
          reference.spacing
        )
      : stageFixture('synthetic-thickness.nrrd');
    await writeManifestToFile(
      {
        version: '7.0.0',
        dataSources: [
          { id: 1, type: 'uri', uri: '/tmp/' + image },
          { id: 2, type: 'uri', uri: '/tmp/' + mask },
          { id: 3, type: 'collection', sources: [2] },
        ],
        datasets: [{ id: 'oct-parent', dataSourceId: 1 }],
        segments: [
          {
            id: 'retina-layer',
            name: comparison
              ? 'Synthetic retinal layer'
              : 'Synthetic retinal band',
            visible: true,
            color: comparison ? [35, 215, 190, 255] : [255, 0, 0, 255],
          },
          {
            id: 'other-layer',
            name: 'Alternative synthetic band',
            visible: true,
            color: [0, 255, 0, 255],
          },
        ].filter((_, index) => !comparison || index === 0),
        selectedSegment: 'retina-layer',
        segmentations: [
          {
            id: 'oct-layer-segmentation',
            name: comparison
              ? 'Synthetic illustrative layer'
              : 'Synthetic thickness bands',
            parentImage: 'oct-parent',
            ...(comparison
              ? { fillOpacity: 0.3, outlineOpacity: 0.75, outlineThickness: 1 }
              : {}),
            order: comparison
              ? ['retina-layer-mask']
              : ['retina-layer-mask', 'other-layer-mask'],
            masks: [
              {
                id: 'retina-layer-mask',
                segmentId: 'retina-layer',
                representations: {
                  labelmap: {
                    artifactId: 'oct-layer-artifact',
                    sourceValue: 1,
                    extent: [0, -1, 0, -1, 0, -1],
                  },
                },
              },
              {
                id: 'other-layer-mask',
                segmentId: 'other-layer',
                representations: {
                  labelmap: {
                    artifactId: 'oct-layer-artifact',
                    sourceValue: 2,
                    extent: [0, -1, 0, -1, 0, -1],
                  },
                },
              },
            ].filter((_, index) => !comparison || index === 0),
          },
        ],
        segmentationArtifacts: [
          {
            id: 'oct-layer-artifact',
            parentImage: 'oct-parent',
            name: 'Synthetic thickness bands',
            dataSourceId: 3,
          },
        ],
      },
      source
    );
  }
  await volViewPage.open('?urls=[tmp/oct-config.json,tmp/' + source + ']');
  await volViewPage.waitForViews();
  const spacing = await waitForFirstCachedImageSpacing();
  spacing.forEach((value, axis) =>
    expect(value).toBeCloseTo(reference.spacing[axis], 6)
  );
  if (comparison) await $(CANVAS).waitForDisplayed();
  else await selectEnFace();
  await waitForProjection('mean');
  await openControls();
}

async function expectSliceLine() {
  await browser.waitUntil(
    async () => {
      const lines = await $$(SLICE_LINE);
      const slice = await volViewPage.getFirst2DSlice();
      return (
        (await lines.length) === 1 &&
        slice !== null &&
        Number(await lines[0].getAttribute('data-y1')) === slice - 0.5
      );
    },
    {
      timeoutMsg:
        'Expected the en face marker to follow the original OCT B-scan',
    }
  );
  const slice = await volViewPage.getFirst2DSlice();
  if (slice === null)
    throw new Error('The original OCT view has no slice position');
  const line = $(SLICE_LINE);
  expect(Number(await line.getAttribute('data-x1'))).toBe(0);
  expect(Number(await line.getAttribute('data-x2'))).toBe(128);
  expect(Number(await line.getAttribute('data-y1'))).toBe(slice - 0.5);
  expect(Number(await line.getAttribute('data-y2'))).toBe(slice - 0.5);
  expect(
    await line.execute((element) =>
      getComputedStyle(element).stroke.replace(/\s/g, '')
    )
  ).toBe('rgb(255,255,0)');
}

describe('Retinal OCT en face viewing', () => {
  afterEach(async function () {
    const captureDirectory = process.env.VOLVIEW_OCT_CAPTURE_DIR;
    if (captureDirectory && this.currentTest?.state === 'failed') {
      fs.mkdirSync(captureDirectory, { recursive: true });
      await browser.saveScreenshot(
        path.join(
          captureDirectory,
          'failure-' + this.currentTest.title.slice(0, 20) + '.png'
        )
      );
    }
  });

  it('loads public real OCT pixels and projects mean, maximum, sum and an inclusive depth slab', async () => {
    await openRetina();
    expect(
      await $('button[data-testid^="control-button-Select "]').isEnabled()
    ).toBe(true);
    expect(
      await $('button[data-testid^="control-button-Paint "]').isEnabled()
    ).toBe(false);
    expect(await $(WINDOW_TOOL).isEnabled()).toBe(true);
    expect(await $(CANVAS).getAttribute('width')).toBe(
      String(reference.size[0])
    );
    expect(await $(CANVAS).getAttribute('height')).toBe(
      String(reference.size[2])
    );
    expect(await $('[data-testid="oct-window-width"]').isExisting()).toBe(
      false
    );
    expect(await $('[data-testid="oct-window-level"]').isExisting()).toBe(
      false
    );
    const compactPanel = await $(
      '[data-testid="oct-rendering-panel"]'
    ).getSize();
    expect(compactPanel.width).toBe(300);
    expect(compactPanel.height).toBeLessThan(450);
    expect(
      await $('[data-testid="oct-advanced-toggle"]').getAttribute(
        'aria-expanded'
      )
    ).toBe('false');
    await expectProjectedPixels(reference.projections.mean);

    await expandAdvanced();
    await selectSetting('oct-projection-method', 'Maximum');
    await waitForProjection('max');
    await expectProjectedPixels(reference.projections.max);
    await selectSetting('oct-projection-method', 'Sum');
    await waitForProjection('sum');
    const sumValues = reference.projections.mean.map(
      (value) => value * reference.size[1]
    );
    await expectProjectedPixels(sumValues);
    // The standard Full Range preset must use projected intensities for Sum.
    await browser.keys('Escape');
    await $(CANVAS).click();
    await $(WINDOW_TOOL).click();
    const fullRange = $('label=Full Range');
    await fullRange.waitForClickable();
    await fullRange.click();
    await browser.keys('Escape');
    await expectProjectedPixels(sumValues);
    expect(
      new Set((await canvasPixels()).map(([gray]) => gray)).size
    ).toBeGreaterThan(1);
    await openControls();
    await expandAdvanced();
    await selectSetting('oct-projection-method', 'Mean');
    await waitForProjection('mean');
    await setNumber('oct-slab-start', reference.slab.start);
    await setNumber('oct-slab-end', reference.slab.end);
    await browser.waitUntil(
      async () =>
        (await $(STATE).getAttribute('data-slab-start')) ===
          String(reference.slab.start) &&
        (await $(STATE).getAttribute('data-slab-end')) ===
          String(reference.slab.end) &&
        (await $(STATE).getAttribute('data-state')) === 'ready'
    );
    await expectProjectedPixels(reference.slab.mean);
    await selectSetting('oct-projection-axis', 'X (columns)');
    await browser.waitUntil(
      async () => (await $(CANVAS).getAttribute('width')) === '222'
    );
    expect(await $(CANVAS).getAttribute('height')).toBe('32');
    expect(
      await $('[data-testid="oct-thin-highlight"] input').isEnabled()
    ).toBe(false);
    expect(await $(THRESHOLD).isEnabled()).toBe(false);
    expect(
      await $('[data-testid="oct-segmentation-segment"] input').isEnabled()
    ).toBe(false);
    expect(
      await $('[data-testid="oct-segmentation-segment"] input').getAttribute(
        'placeholder'
      )
    ).toBe('No associated segmentation');
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('excludes declared DICOM padding and identifies missing projection coverage', async () => {
    const name = STEM + '/retina-padding.dcm';
    const padded = paddedPublicOCT(
      path.join(FIXTURES, 'oct', 'retina-derived.dcm')
    );
    fs.writeFileSync(
      path.join(makeTempDir(STEM), 'retina-padding.dcm'),
      padded.bytes
    );
    await openVolViewPage(name);
    await selectEnFace();
    await waitForProjection('mean');
    await expectEnFacePixels(padded.mean, padded.points);
    const coverage = $('[data-testid="oct-coverage-summary"]');
    expect(await coverage.getAttribute('data-missing-intensity-alines')).toBe(
      '2'
    );
    expect(await coverage.getText()).toContain('A-lines without intensity: 2');
    expect(
      await readEnFacePixels([
        { x: 0, z: 0 },
        { x: 5, z: 12 },
      ])
    ).toEqual([
      [0, 0, 0, 255],
      [0, 0, 0, 255],
    ]);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });
  it('highlights physical thickness, excludes missing masks, and persists compact controls across a session restore', async () => {
    await openRetina(true);
    const unhighlighted = (await canvasPixels([{ x: 5, z: 12 }]))[0][0];
    await enableHighlight();
    await setNumber('oct-thickness-threshold-input', 31);
    await expectHighlightCount(reference.thinColumns);
    const colors = await canvasPixels([
      { x: 5, z: 12 },
      { x: 60, z: 12 },
      { x: 100, z: 12 },
    ]);
    const highlightColor = (await $(STATE).getAttribute('data-highlight-color'))
      ?.split(',')
      .map(Number);
    const opacity = Number(
      await $(STATE).getAttribute('data-highlight-opacity')
    );
    expect(highlightColor).toEqual([255, 0, 0, 255]);
    expect(opacity).toBeCloseTo(0.3, 6);
    expect(colors[0]).toEqual([
      ...highlightColor!
        .slice(0, 3)
        .map((channel) =>
          Math.round(unhighlighted * (1 - opacity) + channel * opacity)
        ),
      255,
    ]);
    expect(colors[1][0]).toBe(colors[1][1]);
    expect(colors[2][0]).toBe(colors[2][1]);

    // The compact slider and numeric input share one physical threshold.
    const slider = $('[data-testid="oct-thickness-threshold"] [role="slider"]');
    expect(await slider.getAttribute('aria-label')).toBe(
      'OCT thickness threshold in micrometers'
    );
    expect(await $(STATE).getAttribute('role')).toBe(null);
    expect(
      await $$('[data-testid="oct-en-face-viewer"] [role="status"]').length
    ).toBe(1);
    await $(THRESHOLD).click();
    await browser.keys('Tab');
    expect(await slider.isFocused()).toBe(true);
    await browser.keys('ArrowRight');
    await browser.waitUntil(
      async () => (await $(THRESHOLD).getValue()) === '31.1'
    );
    await expectHighlightCount(reference.thinColumns);
    await browser.keys('Home');
    await browser.waitUntil(
      async () => (await $(THRESHOLD).getValue()) === '0'
    );
    await expectHighlightCount(0);
    await browser.keys('End');
    await browser.waitUntil(
      async () => (await $(THRESHOLD).getValue()) === '500'
    );
    await expectHighlightCount(reference.allSegmentedColumns);
    expect(await $(STATE).getText()).toContain('Synthetic retinal band');
    expect(
      await $('[data-testid="oct-projection-status"]').getProperty(
        'textContent'
      )
    ).toContain('En face projection ready.');
    await setNumber('oct-thickness-threshold-input', 20);
    await expectHighlightCount(0);
    await setNumber('oct-thickness-threshold-input', 20.8);
    await expectHighlightCount(0);
    await setNumber('oct-thickness-threshold-input', 42);
    await expectHighlightCount(reference.allSegmentedColumns);
    await expandAdvanced();
    await setNumber('oct-slab-start', 0);
    await setNumber('oct-slab-end', 10);
    await expectHighlightCount(reference.allSegmentedColumns);
    await selectSetting(
      'oct-segmentation-segment',
      'Alternative synthetic band'
    );
    await expectHighlightCount(0);
    await setNumber('oct-thickness-threshold-input', 60);
    await expectHighlightCount(reference.alternateSegmentColumns);
    await selectSetting('oct-projection-method', 'Maximum');
    await waitForProjection('max');
    await browser.keys('Escape');
    const saved = await volViewPage.saveSession();
    await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    await volViewPage.open('?urls=[tmp/' + saved + ']');
    await $(CANVAS).waitForDisplayed();
    await expectHighlightCount(reference.alternateSegmentColumns);
    expect(await $(STATE).getAttribute('data-projection-method')).toBe('max');
    expect(await $(STATE).getAttribute('data-slab-start')).toBe('0');
    expect(await $(STATE).getAttribute('data-slab-end')).toBe('10');
    await openControls();
    expect(await $(THRESHOLD).getValue()).toBe('60');
    expect(
      await $('[data-testid="oct-segmentation-segment"]').getText()
    ).toContain('Alternative synthetic band');
    expect(
      await $('[data-testid="oct-thin-highlight"] input').isSelected()
    ).toBe(true);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('restores a nondefault projection axis without resetting the saved slab', async () => {
    await openRetina();
    await expandAdvanced();
    await selectSetting('oct-projection-axis', 'X (columns)');
    await setNumber('oct-slab-start', 10);
    await setNumber('oct-slab-end', 100);
    await selectSetting('oct-projection-method', 'Maximum');
    await waitForProjection('max');
    expect(await $(STATE).getAttribute('data-projection-axis')).toBe('0');
    await browser.keys('Escape');
    const saved = await volViewPage.saveSession();
    await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    await volViewPage.open('?urls=[tmp/' + saved + ']');
    await $(CANVAS).waitForDisplayed();
    await waitForProjection('max');
    expect(await $(CANVAS).getAttribute('width')).toBe('222');
    expect(await $(CANVAS).getAttribute('height')).toBe('32');
    expect(await $(STATE).getAttribute('data-projection-axis')).toBe('0');
    expect(await $(STATE).getAttribute('data-slab-start')).toBe('10');
    expect(await $(STATE).getAttribute('data-slab-end')).toBe('100');
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('uses standard window-level dragging and follows source B-scan keyboard, wheel and slider navigation', async () => {
    await browser.setViewport({
      width: 1440,
      height: 900,
      devicePixelRatio: 1,
    });
    await openRetina(true, true);
    const originalWindow = await getOriginalWindow();
    expect(originalWindow.width).toBeCloseTo(
      reference.range[1] - reference.range[0],
      2
    );
    expect(originalWindow.level).toBeCloseTo(
      (reference.range[1] + reference.range[0]) / 2,
      2
    );
    await browser.keys('Escape');
    await $('[data-testid="oct-rendering-panel"]').waitForDisplayed({
      reverse: true,
    });
    if (
      ((await $('#left-nav').getAttribute('class')) ?? '').includes(
        'v-navigation-drawer--active'
      )
    )
      await $('header i.mdi-menu').click();
    await $(CANVAS).waitForStable();
    await expectStackedSourceMask();
    await volViewPage.focusFirst2DView();
    await expectSliceLine();
    const beforeKey = await volViewPage.getFirst2DSlice();
    if (beforeKey === null)
      throw new Error('The original OCT view has no slice position');
    await volViewPage.advanceSliceAndWait();
    expect(await volViewPage.getFirst2DSlice()).toBeLessThan(beforeKey);
    await expectSliceLine();

    const sourceView = (await volViewPage.getViews2D())[0];
    await sourceView.$('canvas').waitForStable();
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const source = document.querySelector(
            'div[data-testid~="vtk-two-view"]'
          );
          const canvas = source?.querySelector('canvas');
          if (!canvas || !source) return false;
          const rect = canvas.getBoundingClientRect();
          const underPointer = document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2
          );
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            underPointer === canvas &&
            document.querySelectorAll('.v-menu.v-overlay--active').length === 0
          );
        }),
      {
        timeoutMsg:
          'Expected a stable, unobscured source OCT canvas before native wheel input',
      }
    );
    const sourceBounds = (await sourceView.execute((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })) as { x: number; y: number; width: number; height: number };
    const sourceLocation = { x: sourceBounds.x, y: sourceBounds.y };
    const sourceSize = {
      width: sourceBounds.width,
      height: sourceBounds.height,
    };
    const beforeWheel = await volViewPage.getFirst2DSlice();
    await browser
      .action('pointer')
      .move({
        x: Math.round(sourceLocation.x + sourceSize.width / 2),
        y: Math.round(sourceLocation.y + sourceSize.height / 2),
      })
      .perform();
    await browser.performActions([
      {
        type: 'wheel',
        id: 'oct-source-wheel',
        actions: [
          {
            type: 'scroll',
            x: Math.round(sourceLocation.x + sourceSize.width / 2),
            y: Math.round(sourceLocation.y + sourceSize.height / 2),
            deltaX: 0,
            deltaY: 120,
            origin: 'viewport',
          },
        ],
      },
    ]);
    try {
      await browser.waitUntil(
        async () => (await volViewPage.getFirst2DSlice()) !== beforeWheel
      );
    } finally {
      await browser.releaseActions();
    }
    await expectSliceLine();

    const slider = $('.vtk-container-wrapper .slice-slider');
    const sliderLocation = await slider.getLocation();
    const sliderSize = await slider.getSize();
    const beforeSlider = await volViewPage.getFirst2DSlice();
    await browser
      .action('pointer')
      .move({
        x: Math.round(sliderLocation.x + sliderSize.width / 2),
        y: Math.round(sliderLocation.y + sliderSize.height * 0.35),
      })
      .down()
      .up()
      .perform();
    await browser.waitUntil(
      async () => (await volViewPage.getFirst2DSlice()) !== beforeSlider
    );
    await expectSliceLine();

    // Genuine pointer input through the normal toolbar changes rendered pixels.
    const beforePixels = await canvasPixels();
    await dragEnFaceContrast();
    expect(await $(WINDOW_TOOL).getAttribute('class')).toContain(
      'tool-btn-selected'
    );
    expect(await canvasPixels()).not.toEqual(beforePixels);
    await expectProjectedPixels(reference.projections.mean);
    expect(await getOriginalWindow()).toEqual(originalWindow);
    expect(await $('[data-testid="oct-window-width"]').isExisting()).toBe(
      false
    );
    expect(await $('[data-testid="oct-window-level"]').isExisting()).toBe(
      false
    );
    // Return to the central retinal B-scan for the comparison screenshot.
    await browser
      .action('pointer')
      .move({
        x: Math.round(sliderLocation.x + sliderSize.width / 2),
        y: Math.round(sliderLocation.y + sliderSize.height / 2),
      })
      .down()
      .up()
      .perform();
    await expectSliceLine();
    // Restore selection and capture the polished comparison with a textured overlay.
    await $('button[data-testid^="control-button-Select "]').click();
    await openControls();
    const patchPoints = [
      { x: 76, z: 16 },
      { x: 5, z: 12 },
    ];
    const unhighlightedPatch = await canvasPixels(patchPoints);
    await enableHighlight();
    await setNumber('oct-thickness-threshold-input', 31);
    await expectHighlightCount(ILLUSTRATIVE_THIN_COLUMNS);
    expect(await $(STATE).getAttribute('data-highlight-color')).toBe(
      '35,215,190,255'
    );
    expect(
      await $('[data-testid="oct-segmentation-segment"]').getText()
    ).toContain('Synthetic retinal layer');
    const highlightedPatch = await canvasPixels(patchPoints);
    const alpha = Number(await $(STATE).getAttribute('data-highlight-opacity'));
    expect(highlightedPatch[0]).toEqual([
      ...[35, 215, 190].map((channel) =>
        Math.round(unhighlightedPatch[0][0] * (1 - alpha) + channel * alpha)
      ),
      255,
    ]);
    expect(highlightedPatch[1]).toEqual(unhighlightedPatch[1]);
    await expectSliceLine();
    expect(
      await $('[data-testid="oct-rendering-panel"]').getSize()
    ).toMatchObject({ width: 300 });
    await expectControlsBesideSelector();
    const captureDirectory = process.env.VOLVIEW_OCT_CAPTURE_DIR;
    if (captureDirectory) {
      fs.mkdirSync(captureDirectory, { recursive: true });
      await $('.Vue-Toastification__toast').waitForDisplayed({ reverse: true });
      await browser.saveScreenshot(
        path.join(captureDirectory, 'retina-en-face-thickness.png')
      );
    }
    await browser.keys('Escape');
    const savedWindow = await getWindow();
    const saved = await volViewPage.saveSession();
    await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    if (captureDirectory)
      fs.copyFileSync(
        path.join(TEMP_DIR, saved),
        path.join(captureDirectory, 'oct-saved-session.volview.zip')
      );
    await volViewPage.open('?urls=[tmp/' + saved + ']');
    await volViewPage.waitForViews();
    await $(CANVAS).waitForDisplayed();
    await expectHighlightCount(ILLUSTRATIVE_THIN_COLUMNS);
    expect(await $(STATE).getAttribute('data-highlight-color')).toBe(
      '35,215,190,255'
    );
    await openControls();
    expect(
      await $('[data-testid="oct-segmentation-segment"]').getText()
    ).toContain('Synthetic retinal layer');
    await browser.keys('Escape');
    await expectSliceLine();
    expect(await getWindow()).toEqual(savedWindow);
    expect(await getOriginalWindow()).toEqual(originalWindow);
    if (
      ((await $('#left-nav').getAttribute('class')) ?? '').includes(
        'v-navigation-drawer--active'
      )
    )
      await $('header i.mdi-menu').click();
    await $(CANVAS).waitForStable();
    await expectStackedSourceMask();
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('activates the built-in Retinal OCT layout through normal file import and attaches a segmentation through the Data panel', async () => {
    await browser.setViewport({
      width: 1440,
      height: 900,
      devicePixelRatio: 1,
    });
    const image = stageFixture('retina-derived.dcm');
    const mask = stageIllustrativeMask(
      makeTempDir(STEM),
      reference.size,
      reference.spacing
    );
    await volViewPage.open();
    await openThroughDialog(path.join(TEMP_DIR, image));
    await volViewPage.waitForViews();
    const spacing = await waitForFirstCachedImageSpacing();
    spacing.forEach((value, axis) =>
      expect(value).toBeCloseTo(reference.spacing[axis], 6)
    );
    expect(await $(CANVAS).isExisting()).toBe(false);

    await volViewPage.openLayoutMenu();
    const layout = $('[data-testid="oct-layout"]');
    await layout.waitForStable();
    await layout.waitForClickable();
    expect(await layout.getText()).toContain('Retinal OCT');
    await layout.click();
    await browser.keys('Escape');
    await $(CANVAS).waitForDisplayed();
    await waitForProjection('mean');
    expect((await volViewPage.getViews2D()).length).toBe(1);
    await expectProjectedPixels(reference.projections.mean);
    await expectSliceLine();

    await attachMaskThroughDataPanel(STEM + '/' + mask);
    await openAnnotationSegments();
    await waitForSegmentContent('Synthetic retinal layer');
    await selectSegment('Synthetic retinal layer');
    if (
      ((await $('#left-nav').getAttribute('class')) ?? '').includes(
        'v-navigation-drawer--active'
      )
    )
      await $('header i.mdi-menu').click();
    await $(CANVAS).waitForStable();
    await expectStackedSourceMask();

    await openControls();
    expect(
      await $('[data-testid="oct-segmentation-segment"]').getText()
    ).toContain('Synthetic retinal layer');
    await enableHighlight();
    await setNumber('oct-thickness-threshold-input', 31);
    await expectHighlightCount(ILLUSTRATIVE_THIN_COLUMNS);
    expect(await $(STATE).getAttribute('data-highlight-color')).toBe(
      '35,215,190,255'
    );
    expect(
      Number(await $(STATE).getAttribute('data-highlight-opacity'))
    ).toBeCloseTo(0.3, 6);
    await expectControlsBesideSelector();
    await browser.keys('Escape');
    await dragEnFaceContrast();
    const retainedWindow = await getWindow();
    const retainedSlice = await volViewPage.getFirst2DSlice();
    const sourceViewId = await $(SLICE_LINE).getAttribute('data-view-id');
    await volViewPage.openLayoutMenu();
    await $('[data-testid="oct-layout"]').waitForStable();
    await $('[data-testid="oct-layout"]').waitForClickable();
    await $('[data-testid="oct-layout"]').click();
    await browser.keys('Escape');
    await expectHighlightCount(ILLUSTRATIVE_THIN_COLUMNS);
    expect(await getWindow()).toEqual(retainedWindow);
    expect(await volViewPage.getFirst2DSlice()).toBe(retainedSlice);
    expect(await $(SLICE_LINE).getAttribute('data-view-id')).toBe(sourceViewId);
    await expectSliceLine();
    await openControls();
    expect(
      await $('[data-testid="oct-segmentation-segment"]').getText()
    ).toContain('Synthetic retinal layer');
    expect(Number(await $(THRESHOLD).getValue())).toBe(31);
    await browser.keys('Escape');
    await volViewPage.focusFirst2DView();
    const before = await volViewPage.getFirst2DSlice();
    if (before === null)
      throw new Error('The original OCT has no slice position');
    await volViewPage.advanceSliceAndWait();
    expect(await volViewPage.getFirst2DSlice()).toBeLessThan(before);
    await expectSliceLine();
    await browser.keys('ArrowUp');
    await browser.waitUntil(
      async () => (await volViewPage.getFirst2DSlice()) === before
    );
    await expectSliceLine();

    const saved = await volViewPage.saveSession();
    await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    const captureDirectory = process.env.VOLVIEW_OCT_CAPTURE_DIR;
    if (captureDirectory) {
      fs.mkdirSync(captureDirectory, { recursive: true });
      fs.copyFileSync(
        path.join(TEMP_DIR, saved),
        path.join(captureDirectory, 'oct-production-saved-session.volview.zip')
      );
    }
    await volViewPage.open('?urls=[tmp/' + saved + ']');
    await volViewPage.waitForViews();
    await $(CANVAS).waitForDisplayed();
    await expectHighlightCount(ILLUSTRATIVE_THIN_COLUMNS);
    await expectSliceLine();
    if (
      ((await $('#left-nav').getAttribute('class')) ?? '').includes(
        'v-navigation-drawer--active'
      )
    )
      await $('header i.mdi-menu').click();
    await $(CANVAS).waitForStable();
    await expectStackedSourceMask();
    expect(await $(STATE).getAttribute('data-highlight-color')).toBe(
      '35,215,190,255'
    );
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  for (const format of ['nrrd', 'nii', 'vti'] as const) {
    it(
      'manually projects public OCT pixels from ' +
        format +
        ' with an explicit axis and restores its settings',
      async () => {
        const directory = makeTempDir(STEM);
        const name = stageGenericOCT(directory, format);
        await volViewPage.open();
        await openThroughDialog(path.join(directory, name));
        await volViewPage.waitForViews();
        expect(await $(CANVAS).isExisting()).toBe(false);
        const viewCount = (await $$('.view-type-select')).length;
        const spacing = await waitForFirstCachedImageSpacing();
        expect(Math.abs(spacing[0])).toBeCloseTo(reference.spacing[0], 6);
        expect(spacing[1]).toBeCloseTo(reference.spacing[2], 6);
        expect(spacing[2]).toBeCloseTo(reference.spacing[1], 6);
        if (format === 'vti') expect(spacing[0]).toBeLessThan(0);
        await selectEnFace();
        await waitForProjection('mean');
        expect((await $$('.view-type-select')).length).toBe(viewCount);
        await openControls();
        expect(
          await $('[data-testid="oct-advanced-toggle"]').getAttribute(
            'aria-expanded'
          )
        ).toBe('true');
        await selectSetting('oct-projection-axis', 'Z (frames)');
        await browser.waitUntil(
          async () => (await $(CANVAS).getAttribute('height')) === '32'
        );
        await waitForProjection('mean');
        await expectProjectedPixels(reference.projections.mean);
        const display = await $(CANVAS).getSize();
        expect(display.width).toBeGreaterThan(0);
        expect(display.height).toBeGreaterThan(0);
        expect(display.width / display.height).toBeCloseTo(1, 1);
        await setNumber('oct-slab-start', reference.slab.start);
        await setNumber('oct-slab-end', reference.slab.end);
        await waitForProjection('mean');
        await expectProjectedPixels(reference.slab.mean);
        await browser.keys('Escape');
        const saved = await volViewPage.saveSession();
        await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
        await volViewPage.open();
        await openThroughDialog(path.join(TEMP_DIR, saved));
        await volViewPage.waitForViews();
        await $(CANVAS).waitForDisplayed();
        await waitForProjection('mean');
        expect(await $(STATE).getAttribute('data-projection-axis')).toBe('2');
        expect(await $(STATE).getAttribute('data-slab-start')).toBe(
          String(reference.slab.start)
        );
        expect(await $(STATE).getAttribute('data-slab-end')).toBe(
          String(reference.slab.end)
        );
        await expectProjectedPixels(reference.slab.mean);
        await openControls();
        expect(
          await $('[data-testid="oct-projection-axis"] input').getValue()
        ).toBe('Z (frames)');
      }
    );
  }

  it('renders NIfTI with unknown units while keeping physical thickness disabled with a reason', async () => {
    const directory = makeTempDir(STEM);
    const name = stageGenericOCT(directory, 'nii', false);
    await volViewPage.open();
    await openThroughDialog(path.join(directory, name));
    await volViewPage.waitForViews();
    await selectEnFace();
    await openControls();
    await selectSetting('oct-projection-axis', 'Z (frames)');
    await browser.waitUntil(
      async () => (await $(CANVAS).getAttribute('height')) === '32'
    );
    await waitForProjection('mean');
    await expectProjectedPixels(reference.projections.mean);
    await browser.keys('Escape');
    await attachMaskThroughDataPanel(stageFixture('synthetic-thickness.nrrd'));
    await openControls();
    await browser.waitUntil(async () =>
      $('[data-testid="oct-segmentation-segment"] input').isEnabled()
    );
    expect(
      await $('[data-testid="oct-thin-highlight"] input').isEnabled()
    ).toBe(false);
    expect(await $(THRESHOLD).isEnabled()).toBe(false);
    await $('[data-testid="oct-thin-highlight"]').$('..').moveTo();
    const reason = $('.v-overlay--active.v-tooltip .v-overlay__content');
    await reason.waitForDisplayed();
    expect(await reason.getText()).toContain('units or spacing');
  });

  it('keeps en face visible and disabled for a non-ophthalmic DICOM volume with a reason', async () => {
    const image = STEM + '/oct-unrelated.dcm';
    fs.writeFileSync(
      path.join(makeTempDir(STEM), 'oct-unrelated.dcm'),
      nonOCTDicom(path.join(FIXTURES, 'oct', 'retina-derived.dcm'))
    );
    await openVolViewPage(image);
    await expectEnFaceDisabledInSwitcher('OCT');
    await browser.keys('Escape');
    await volViewPage.openLayoutMenu();
    const octLayout = $('[data-testid="oct-layout"]');
    await octLayout.waitForDisplayed();
    expect(await octLayout.getAttribute('class')).toContain(
      'v-list-item--disabled'
    );
    await octLayout.$('..').moveTo();
    const layoutReason = $('.v-overlay--active.v-tooltip .v-overlay__content');
    await layoutReason.waitForDisplayed();
    expect(await layoutReason.getText()).toContain('OCT');

    await writeManifestToFile(
      { layouts: { 'Unavailable OCT test': [['enface']] } },
      'oct-unavailable.json'
    );
    await volViewPage.open(
      '?urls=[tmp/oct-unavailable.json,tmp/' + image + ']'
    );
    await $(STATE).waitForDisplayed();
    expect(await $(STATE).getAttribute('data-state')).toBe('unavailable');
    const windowTool = $(WINDOW_TOOL);
    expect(await windowTool.isDisplayed()).toBe(true);
    expect(await windowTool.isEnabled()).toBe(false);
    const selectTool = $('button[data-testid^="control-button-Select "]');
    expect(await selectTool.isEnabled()).toBe(true);
    await selectTool.click();
    expect(await selectTool.getAttribute('class')).toContain(
      'tool-btn-selected'
    );
    await windowTool.$('..').moveTo();
    const tooltip = $('.v-overlay--active.v-tooltip .v-overlay__content');
    await tooltip.waitForDisplayed();
    expect(await tooltip.getText()).toContain('OCT');
    // The same unavailable capability gates the normal keyboard shortcut.
    const shortcut = (await windowTool.getAttribute('data-testid'))?.match(
      /\[([^\]]+)\]/
    )?.[1];
    if (!shortcut) throw new Error('Window & Level has no displayed shortcut');
    await browser.keys(
      shortcut.length === 1 ? shortcut.toLowerCase() : shortcut
    );
    expect(await selectTool.getAttribute('class')).toContain(
      'tool-btn-selected'
    );
    expect(await windowTool.isEnabled()).toBe(false);
  });

  it('declines an OCT radial acquisition that requires spatial reconstruction', async () => {
    const source = stageFixture('retina-derived.dcm');
    const raw = fs.readFileSync(path.join(TEMP_DIR, source));
    const scanPatternOffset = raw.indexOf(Buffer.from('128280'));
    expect(scanPatternOffset).toBeGreaterThan(0);
    Buffer.from('128282').copy(raw, scanPatternOffset);
    const file = STEM + '/retina-derived-radial.dcm';
    fs.writeFileSync(path.join(TEMP_DIR, file), raw);
    await openVolViewPage(file);
    await expectEnFaceDisabledInSwitcher('spatial reconstruction');
  });
});
