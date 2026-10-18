import fs from 'node:fs';
import path from 'node:path';
import {
  dragContrast,
  enFaceAppearance,
  waitForEnFaceReady,
  stageIllustrativeMask,
  stageGenericOCT,
  expectStackedSourceMask,
  expectControlsBesideSelector,
  expectEnFaceDisabledInSwitcher,
  expandEnFaceSection,
  setSlabRange,
  slabThumb,
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
import {
  deflatedExplicitVR,
  nonOCTDicom,
  syntheticMask,
} from '../fixtures/oct/volumes';
import { createSyntheticOCT } from '../fixtures/oct/dicom';
import { paddedSyntheticOCT } from '../fixtures/oct/padding';
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
  slab: { start: number; end: number };
  thinColumns: number;
};
const CANVAS = '[data-testid="oct-en-face-canvas"]';
const CONTROLS = '[data-testid="oct-en-face-controls"]';
const THRESHOLD = '[data-testid="oct-thickness-threshold-input"] input';
const WINDOW_TOOL = 'button[data-testid^="control-button-Window & Level "]';
const SLICE_LINE = '[data-testid="oct-slice-line"]';
const STEM = 'oct-fixtures';

function stageFixture(name: string) {
  const directory = makeTempDir(STEM);
  fs.writeFileSync(
    path.join(directory, name),
    name.endsWith('.dcm') ? createSyntheticOCT() : syntheticMask()
  );
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
  await waitForEnFaceReady();
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

async function setThicknessThreshold(value: number) {
  await expandEnFaceSection('thickness');
  const input = $(THRESHOLD);
  await input.scrollIntoView({ block: 'center', inline: 'nearest' });
  await input.waitForClickable();
  await setValueVueInput(input, String(value));
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

async function setEnFaceWindow(width: number, level: number) {
  await browser.keys('Escape');
  await $(CANVAS).click();
  await $(WINDOW_TOOL).click();
  const manual = $$('.v-overlay--active .manual-inputs input');
  await manual[0].waitForDisplayed();
  await setValueVueInput(manual[0], String(width));
  await setValueVueInput(manual[1], String(level));
  await browser.keys('Escape');
  await manual[0].waitForDisplayed({ reverse: true });
}

async function expectProjectionPixel(gray: number) {
  const source = await $(CANVAS).getElement();
  await browser.waitUntil(
    async () => {
      const pixel = await source.execute((element) => {
        const canvas = element as HTMLCanvasElement;
        const transform = document
          .querySelector<SVGGElement>('[data-testid="oct-slice-lines"] g')!
          .getScreenCTM()!;
        const center = new DOMPoint(60.5, 12.5).matrixTransform(transform);
        const bounds = canvas.getBoundingClientRect();
        const x = Math.floor(
          ((center.x - bounds.left) * canvas.width) / bounds.width
        );
        const y = Math.floor(
          ((center.y - bounds.top) * canvas.height) / bounds.height
        );
        const copy = document.createElement('canvas');
        copy.width = canvas.width;
        copy.height = canvas.height;
        const context = copy.getContext('2d')!;
        context.drawImage(canvas, 0, 0);
        return Array.from(context.getImageData(x, y, 1, 1).data);
      });
      return (
        pixel[3] === 255 &&
        pixel.slice(0, 3).every((channel) => Math.abs(channel - gray) <= 1)
      );
    },
    { timeoutMsg: `Expected en face pixel (60, 12) to be grayscale ${gray}` }
  );
}

async function enableHighlight() {
  await expandEnFaceSection('thickness');
  const label = $('[data-testid="oct-thin-highlight"] label');
  await label.scrollIntoView({ block: 'center', inline: 'nearest' });
  await label.waitForClickable();
  if (!(await $('[data-testid="oct-thin-highlight"] input').isSelected()))
    await label.click();
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
  await dragContrast(await $(CANVAS).getElement(), 60, 40, 300);
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

async function expectHighlight(present: boolean) {
  await waitForEnFaceReady();
  const outline = $('[data-testid="oct-thin-outline"]');
  if (present) await expect(outline).toBeDisplayed();
  else await expect(outline).not.toExist();
}

async function expectCalibratedEnFace() {
  await waitForEnFaceReady();
  const spacing = await waitForFirstCachedImageSpacing();
  spacing.forEach((value, axis) =>
    expect(value).toBeCloseTo(reference.spacing[axis], 6)
  );
  expect(await volViewPage.getNotificationsCount()).toBe(0);
}

async function expectStackedMaskWithoutSidebar() {
  if (
    ((await $('#left-nav').getAttribute('class')) ?? '').includes(
      'v-navigation-drawer--active'
    )
  )
    await $('header i.mdi-menu').click();
  await $(CANVAS).waitForStable();
  await expectStackedSourceMask();
}

async function openRetina(withMask = false, comparison = false) {
  const image = stageFixture('synthetic-oct.dcm');
  await writeManifestToFile(
    {
      layouts: {
        'OCT test': comparison ? [['axial'], ['enface']] : [['axial']],
      },
    },
    'oct-config.json'
  );
  await volViewPage.open('?urls=[tmp/oct-config.json,tmp/' + image + ']');
  await volViewPage.waitForViews();
  const spacing = await waitForFirstCachedImageSpacing();
  spacing.forEach((value, axis) =>
    expect(value).toBeCloseTo(reference.spacing[axis], 6)
  );
  if (comparison) await $(CANVAS).waitForDisplayed();
  else await selectEnFace();
  await waitForEnFaceReady();
  if (withMask) {
    const mask = comparison
      ? STEM + '/' + stageIllustrativeMask(makeTempDir(STEM))
      : stageFixture('synthetic-thickness.nrrd');
    await attachMaskThroughDataPanel(mask);
    await openAnnotationSegments();
    const segment = comparison
      ? 'Synthetic retinal layer'
      : 'Synthetic retinal band';
    await waitForSegmentContent(segment);
    await selectSegment(segment);
  }
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
        Number(await lines[0].getAttribute('y1')) === slice - 0.5
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
  expect(Number(await line.getAttribute('x1'))).toBe(0);
  expect(Number(await line.getAttribute('x2'))).toBe(128);
  expect(Number(await line.getAttribute('y1'))).toBe(slice - 0.5);
  expect(Number(await line.getAttribute('y2'))).toBe(slice - 0.5);
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

  it('keeps both stacked views visible when double-clicking rendering controls and the view selector', async () => {
    await openRetina(true, true);
    const source = (await volViewPage.getViews2D())[0];
    const expectBothViews = async () => {
      await expect(source.$('canvas')).toBeDisplayed();
      await expect($(CANVAS)).toBeDisplayed();
    };
    await $(CONTROLS).doubleClick();
    await expectBothViews();
    const panel = $('[data-testid="oct-rendering-panel"]');
    if (!(await panel.isDisplayed())) await openControls();
    await enableHighlight();
    const inlineHelp = await $('[data-testid="oct-thickness-help"]').execute(
      (button) => {
        const text = button.parentElement?.parentElement?.firstChild;
        if (!text) return false;
        const range = document.createRange();
        range.selectNodeContents(text);
        const caption = range.getBoundingClientRect();
        const icon = button.getBoundingClientRect();
        return (
          icon.left >= caption.right &&
          icon.top < caption.bottom &&
          icon.bottom > caption.top
        );
      }
    );
    expect(inlineHelp).toBe(true);
    await $(THRESHOLD).doubleClick();
    await expectBothViews();
    await $(
      '[data-testid="oct-thickness-threshold"] [role="slider"]'
    ).doubleClick();
    await expectBothViews();
    await browser.keys('Escape');
    await $(
      '[data-testid="oct-en-face-viewer"] .view-type-select .v-field'
    ).doubleClick();
    await browser.keys('Escape');
    await expectBothViews();
  });

  it('changes projection, slab, axis and windowing through compact controls', async () => {
    await openRetina();
    expect(await $(WINDOW_TOOL).isEnabled()).toBe(true);
    const compactPanel = await $(
      '[data-testid="oct-rendering-panel"]'
    ).getSize();
    expect(compactPanel.width).toBe(300);
    expect(compactPanel.height).toBeLessThanOrEqual(560);
    for (const section of ['projection', 'thickness'])
      await expect(
        $('[data-testid="oct-' + section + '-toggle"]')
      ).toHaveAttribute('aria-expanded', 'true');
    await setEnFaceWindow(1000, 500);
    // Fixed windowing distinguishes the fixture's mean 317, max 538 and sum 70374.
    await expectProjectionPixel(81);
    const mean = await enFaceAppearance();
    await openControls();
    await expandEnFaceSection('projection');
    await selectSetting('oct-projection-method', 'Maximum');
    await waitForEnFaceReady();
    await expect($('[data-testid="oct-projection-method"] input')).toHaveValue(
      'Maximum'
    );
    await expectProjectionPixel(137);
    await selectSetting('oct-projection-method', 'Sum');
    await waitForEnFaceReady();
    await expect($('[data-testid="oct-projection-method"] input')).toHaveValue(
      'Sum'
    );
    await expectProjectionPixel(255);
    await selectSetting('oct-projection-method', 'Mean');
    await setSlabRange(reference.slab.start, reference.slab.end);
    await waitForEnFaceReady();
    await setEnFaceWindow(1, 202.5);
    expect(await getWindow()).toEqual({ width: 1, level: 202.5 });
    await browser.waitUntil(
      async () => (await enFaceAppearance()).image !== mean.image
    );
    await openControls();
    await expandEnFaceSection('projection');
    await selectSetting('oct-projection-axis', 'X (columns)');
    await waitForEnFaceReady();
    await expect($('[data-testid="oct-projection-axis"] input')).toHaveValue(
      'X (columns)'
    );
    await expect(slabThumb('start')).toHaveAttribute('aria-valuenow', '0');
    await expect(slabThumb('end')).toHaveAttribute('aria-valuenow', '127');
    await expandEnFaceSection('thickness');
    await expect($('[data-testid="oct-thin-highlight"] input')).toBeDisabled();
    await expect($(THRESHOLD)).toBeDisabled();
    await expect(
      $('[data-testid="oct-segmentation-segment"] input')
    ).toBeDisabled();
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('renders a DICOM volume containing declared padding', async () => {
    const name = STEM + '/retina-padding.dcm';
    const padded = paddedSyntheticOCT(createSyntheticOCT());
    fs.writeFileSync(
      path.join(makeTempDir(STEM), 'retina-padding.dcm'),
      padded.bytes
    );
    await openVolViewPage(name);
    await selectEnFace();
    await expectCalibratedEnFace();
  });
  it('imports deflated OCT through the file dialog with calibrated geometry and padding', async () => {
    const directory = makeTempDir(STEM);
    const file = path.join(directory, 'retina-padding-deflated.dcm');
    const padded = paddedSyntheticOCT(createSyntheticOCT());
    fs.writeFileSync(file, deflatedExplicitVR(padded.bytes));
    await volViewPage.open();
    await openThroughDialog(file);
    await volViewPage.waitForViews();
    await volViewPage.openLayoutMenu();
    const layout = $('[data-testid="oct-layout"]');
    await layout.waitForClickable();
    expect(await layout.getAttribute('class')).not.toContain(
      'v-list-item--disabled'
    );
    await layout.click();
    await $(CANVAS).waitForDisplayed();
    await expectCalibratedEnFace();
  });
  it('highlights physical thickness and restores its selected segment, threshold and slab', async () => {
    await openRetina(true);
    await enableHighlight();
    await setThicknessThreshold(31);
    await expectHighlight(true);
    const thinOutline = await $(
      '[data-testid="oct-thin-outline"]'
    ).getAttribute('d');
    const slider = $('[data-testid="oct-thickness-threshold"] [role="slider"]');
    await $(THRESHOLD).click();
    await browser.keys('Tab');
    await expect(slider).toBeFocused();
    await browser.keys('ArrowRight');
    await expect($(THRESHOLD)).toHaveValue('31.1');
    await browser.keys('Home');
    await expect($(THRESHOLD)).toHaveValue('0');
    await expectHighlight(false);
    const maximum = await slider.getAttribute('aria-valuemax');
    await browser.keys('End');
    await expect($(THRESHOLD)).toHaveValue(maximum!);
    await expectHighlight(true);
    await setThicknessThreshold(20.8);
    await expectHighlight(false);
    await setThicknessThreshold(31);
    await expectHighlight(true);
    await expect($('[data-testid="oct-thin-outline"]')).toHaveAttribute(
      'd',
      thinOutline!
    );
    await expandEnFaceSection('projection');
    await setSlabRange(0, 10);
    await expectHighlight(true);
    await expect($('[data-testid="oct-thin-outline"]')).toHaveAttribute(
      'd',
      thinOutline!
    );
    await selectSetting(
      'oct-segmentation-segment',
      'Alternative synthetic band'
    );
    await expectHighlight(false);
    await setThicknessThreshold(60);
    await expectHighlight(true);
    await selectSetting('oct-projection-method', 'Maximum');
    await waitForEnFaceReady();
    await browser.keys('Escape');
    const saved = await volViewPage.saveSession();
    await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    await volViewPage.open('?urls=[tmp/' + saved + ']');
    await waitForEnFaceReady();
    await expectHighlight(true);
    await openControls();
    await expandEnFaceSection('projection');
    await expect($('[data-testid="oct-projection-method"] input')).toHaveValue(
      'Maximum'
    );
    await expect(slabThumb('start')).toHaveAttribute('aria-valuenow', '0');
    await expect(slabThumb('end')).toHaveAttribute('aria-valuenow', '10');
    await expandEnFaceSection('thickness');
    await expect($(THRESHOLD)).toHaveValue('60');
    await expect($('[data-testid="oct-segmentation-segment"]')).toHaveText(
      expect.stringContaining('Alternative synthetic band')
    );
    await expect($('[data-testid="oct-thin-highlight"] input')).toBeSelected();
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('restores a nondefault projection axis without resetting the saved slab', async () => {
    await openRetina();
    await expandEnFaceSection('projection');
    await selectSetting('oct-projection-axis', 'X (columns)');
    await setSlabRange(10, 100);
    await selectSetting('oct-projection-method', 'Maximum');
    await waitForEnFaceReady();
    expect(
      await $('[data-testid="oct-projection-axis"] input').getValue()
    ).toBe('X (columns)');
    await browser.keys('Escape');
    const saved = await volViewPage.saveSession();
    await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    await volViewPage.open('?urls=[tmp/' + saved + ']');
    await $(CANVAS).waitForDisplayed();
    await waitForEnFaceReady();
    await openControls();
    await expandEnFaceSection('projection');
    await expect($('[data-testid="oct-projection-axis"] input')).toHaveValue(
      'X (columns)'
    );
    await expect(slabThumb('start')).toHaveAttribute('aria-valuenow', '10');
    await expect(slabThumb('end')).toHaveAttribute('aria-valuenow', '100');
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('uses standard pan, zoom and windowing while following source B-scan navigation', async () => {
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
    await expectStackedMaskWithoutSidebar();
    const renderedCanvas = await $(CANVAS).getElement();
    const viewport = await renderedCanvas.execute((element) => {
      const canvas = element.getBoundingClientRect();
      const view = element
        .closest('[data-testid="oct-en-face-viewer"]')!
        .getBoundingClientRect();
      return {
        widthDifference: Math.abs(canvas.width - view.width),
        heightDifference: Math.abs(canvas.height - view.height),
      };
    });
    expect(viewport.widthDifference).toBeLessThan(2);
    expect(viewport.heightDifference).toBeLessThan(2);
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

    const projectionGeometry = $('[data-testid="oct-slice-lines"] > g');
    const beforePan = await projectionGeometry.getAttribute('transform');
    await $('button[data-testid^="control-button-Pan "]').click();
    await dragContrast(await $(CANVAS).getElement(), 55, 30);
    await browser.waitUntil(
      async () =>
        (await projectionGeometry.getAttribute('transform')) !== beforePan
    );
    const beforeZoom = await $(SLICE_LINE).getSize();
    await $('button[data-testid^="control-button-Zoom "]').click();
    await dragContrast(await $(CANVAS).getElement(), 0, -60);
    await browser.waitUntil(
      async () => (await $(SLICE_LINE).getSize()).width !== beforeZoom.width
    );

    // Genuine pointer input through the normal toolbar changes rendered pixels.
    const beforePixels = (await enFaceAppearance()).image;
    await dragEnFaceContrast();
    expect(await $(WINDOW_TOOL).getAttribute('class')).toContain(
      'tool-btn-selected'
    );
    expect((await enFaceAppearance()).image).not.toBe(beforePixels);
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
    await enableHighlight();
    await setThicknessThreshold(31);
    await expectHighlight(true);
    await browser.waitUntil(
      async () => (await enFaceAppearance()).coloredPixels > 100
    );
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
    await expectHighlight(true);
    await openControls();
    await expandEnFaceSection('thickness');
    expect(
      await $('[data-testid="oct-segmentation-segment"]').getText()
    ).toContain('Synthetic retinal layer');
    await browser.keys('Escape');
    await expectSliceLine();
    expect(await getWindow()).toEqual(savedWindow);
    expect(await getOriginalWindow()).toEqual(originalWindow);
    await expectStackedMaskWithoutSidebar();
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('activates the built-in Retinal OCT layout through normal file import and attaches a segmentation through the Data panel', async () => {
    await browser.setViewport({
      width: 1440,
      height: 900,
      devicePixelRatio: 1,
    });
    const image = stageFixture('synthetic-oct.dcm');
    const mask = stageIllustrativeMask(makeTempDir(STEM));
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
    await waitForEnFaceReady();
    expect((await volViewPage.getViews2D()).length).toBe(1);
    await expectSliceLine();

    await attachMaskThroughDataPanel(STEM + '/' + mask);
    await openAnnotationSegments();
    await waitForSegmentContent('Synthetic retinal layer');
    await selectSegment('Synthetic retinal layer');
    await expectStackedMaskWithoutSidebar();

    await openControls();
    await enableHighlight();
    expect(
      await $('[data-testid="oct-segmentation-segment"]').getText()
    ).toContain('Synthetic retinal layer');
    await setThicknessThreshold(31);
    await expectHighlight(true);
    await expectControlsBesideSelector();
    await browser.keys('Escape');
    await dragEnFaceContrast();
    const retainedWindow = await getWindow();
    const retainedSlice = await volViewPage.getFirst2DSlice();
    await volViewPage.openLayoutMenu();
    await $('[data-testid="oct-layout"]').waitForStable();
    await $('[data-testid="oct-layout"]').waitForClickable();
    await $('[data-testid="oct-layout"]').click();
    await browser.keys('Escape');
    await expectHighlight(true);
    expect(await getWindow()).toEqual(retainedWindow);
    expect(await volViewPage.getFirst2DSlice()).toBe(retainedSlice);
    await expectSliceLine();
    await openControls();
    await expandEnFaceSection('thickness');
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
    await expectHighlight(true);
    await expectSliceLine();
    await expectStackedMaskWithoutSidebar();
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  for (const format of ['nrrd', 'nii', 'vti'] as const) {
    it(
      'manually projects generated OCT pixels from ' +
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
        await waitForEnFaceReady();
        expect((await $$('.view-type-select')).length).toBe(viewCount);
        await openControls();
        expect(
          await $('[data-testid="oct-projection-toggle"]').getAttribute(
            'aria-expanded'
          )
        ).toBe('true');
        await expandEnFaceSection('projection');
        await selectSetting('oct-projection-axis', 'Z (frames)');
        await waitForEnFaceReady();
        const display = await $(CANVAS).getSize();
        expect(display.width).toBeGreaterThan(0);
        expect(display.height).toBeGreaterThan(0);
        await setSlabRange(reference.slab.start, reference.slab.end);
        await waitForEnFaceReady();
        await browser.keys('Escape');
        const saved = await volViewPage.saveSession();
        await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
        await volViewPage.open();
        await openThroughDialog(path.join(TEMP_DIR, saved));
        await volViewPage.waitForViews();
        await $(CANVAS).waitForDisplayed();
        await waitForEnFaceReady();
        await openControls();
        await expandEnFaceSection('projection');
        expect(
          await $('[data-testid="oct-projection-axis"] input').getValue()
        ).toBe('Z (frames)');
        await expect(slabThumb('start')).toHaveAttribute(
          'aria-valuenow',
          String(reference.slab.start)
        );
        await expect(slabThumb('end')).toHaveAttribute(
          'aria-valuenow',
          String(reference.slab.end)
        );
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
    await expandEnFaceSection('projection');
    await selectSetting('oct-projection-axis', 'Z (frames)');
    await waitForEnFaceReady();
    await browser.keys('Escape');
    await attachMaskThroughDataPanel(stageFixture('synthetic-thickness.nrrd'));
    await openControls();
    await expandEnFaceSection('thickness');
    await expect($('[data-testid="oct-segmentation-segment"]')).toHaveText(
      expect.stringContaining('Synthetic retinal band')
    );
    await expect(
      $('[data-testid="oct-segmentation-segment"] input')
    ).toBeDisabled();
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
      nonOCTDicom(createSyntheticOCT())
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
    const status = $('[data-testid="oct-projection-status"]');
    await expect(status).toBeDisplayed();
    await expect(status).toHaveText(expect.stringContaining('ophthalmic OCT'));
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
    const source = stageFixture('synthetic-oct.dcm');
    const raw = fs.readFileSync(path.join(TEMP_DIR, source));
    const scanPatternOffset = raw.indexOf(Buffer.from('128280'));
    expect(scanPatternOffset).toBeGreaterThan(0);
    Buffer.from('128282').copy(raw, scanPatternOffset);
    const file = STEM + '/synthetic-oct-radial.dcm';
    fs.writeFileSync(path.join(TEMP_DIR, file), raw);
    await openVolViewPage(file);
    await expectEnFaceDisabledInSwitcher('spatial reconstruction');
  });

  it('renders below-threshold outlines with the normal segmentation fill, outline and visibility controls', async () => {
    await openRetina(true);
    const unhighlighted = (await enFaceAppearance()).image;
    await enableHighlight();
    await setThicknessThreshold(31);
    await expectHighlight(true);
    await browser.waitUntil(
      async () => (await enFaceAppearance()).coloredPixels > 100
    );
    await browser.keys('Escape');
    const outline = () => $('[data-testid="oct-thin-outline"]');
    await expect(outline()).toBeDisplayed();
    const shape = await outline().execute((element) => {
      const bounds = (element as unknown as SVGGraphicsElement).getBBox();
      const style = getComputedStyle(element);
      return {
        x: bounds.x,
        width: bounds.width,
        color: style.stroke,
        vectorEffect: style.vectorEffect,
      };
    });
    expect(shape).toEqual({
      x: 0,
      width: reference.thinColumns / reference.size[2],
      color: 'rgb(255, 0, 0)',
      vectorEffect: 'non-scaling-stroke',
    });
    await openAnnotationSegments();
    const display = $('[data-testid="segment-display-section"]');
    if ((await display.getAttribute('aria-expanded')) !== 'true')
      await display.click();
    const setDisplaySlider = async (name: string, key: 'Home' | 'End') => {
      const slider = $(
        '[data-testid="segment-list"] [role="slider"][aria-label="' +
          name +
          '"]'
      );
      await slider.scrollIntoView({ block: 'center' });
      await slider.waitForStable();
      await slider.click();
      await browser.keys(key);
    };
    await setDisplaySlider('Fill Opacity', 'Home');
    await browser.waitUntil(
      async () => (await enFaceAppearance()).image === unhighlighted
    );
    await expect(outline()).toBeDisplayed();
    await expectHighlight(true);
    await setDisplaySlider('Outline Opacity', 'Home');
    await expect(outline()).not.toExist();
    await setDisplaySlider('Outline Opacity', 'End');
    await expect(outline()).toBeDisplayed();
    await setDisplaySlider('Outline Thickness', 'End');
    await expect(outline()).toHaveAttribute('stroke-width', '10');
    await setDisplaySlider('Outline Thickness', 'Home');
    await expect(outline()).not.toExist();
    await setDisplaySlider('Outline Thickness', 'End');
    await expect(outline()).toBeDisplayed();
    await $('[data-testid="toggle-segments-visible-button"]').click();
    await expect(outline()).not.toExist();
    await setDisplaySlider('Fill Opacity', 'End');
    await expect(outline()).not.toExist();
    expect((await enFaceAppearance()).image).toBe(unhighlighted);
    await $('[data-testid="toggle-segments-visible-button"]').click();
    await expect(outline()).toBeDisplayed();
  });
});
