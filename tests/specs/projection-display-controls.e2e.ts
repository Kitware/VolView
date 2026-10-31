import path from 'node:path';
import { useReferenceLines } from './referenceLinesTestUtils';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import { selectBasePalette } from './layerDisplayTestUtils';
import {
  canvasAppearance,
  chooseEnFaceProjection,
  displayedWindow,
  expandEnFaceSection,
  dragContrast,
  enFaceAppearance,
  enFacePixel,
  getEnFaceWindow,
  setEnFaceWindow,
  setSlabRange,
  waitForEnFaceReady,
  CANVAS,
  VIEWER,
  PANEL,
} from './octTestUtils';
import { stageProjectionContrastVolume } from './projectionTestUtils';
import {
  expectNoRedrawInterruption,
  observeProjectionRedraw,
  requestEnFaceWindow,
} from './slabContrastTestUtils';
import {
  makeTempDir,
  openVolViewPage,
  SESSION_SAVE_TIMEOUT,
  waitForDownload,
  waitForModuleTransitions,
  writeManifestToFile,
} from './utils';
import { selectSetting } from './octInteractionTestUtils';

const STEM = 'projection-display-controls';
const SIDEBAR = '[data-testid="enface-sidebar-controls"]';
const SECTION = '[data-testid="enface-rendering-section"]';
const ENFACE_SELECTOR = '[data-testid="enface-view-selector"]';
const field = (endpoint: 'min' | 'max') =>
  $(`[data-testid="base-image-range-${endpoint}"] input`);

async function openProjectionDisplay(mixed = false) {
  stageProjectionContrastVolume(makeTempDir(STEM));
  await writeManifestToFile(
    {
      layouts: {
        Projection: [mixed ? ['axial', 'enface', 'enface'] : ['enface']],
      },
    },
    `${STEM}.json`
  );
  await volViewPage.open(`?urls=[tmp/${STEM}.json,tmp/${STEM}/source.nrrd]`);
  await expect($$(VIEWER)).toBeElementsArrayOfSize(mixed ? 2 : 1);
  const views = await $$(VIEWER).map((view) => view.getElement());
  for (const view of views) await waitForEnFaceReady(view);
  await views[0].$(CANVAS).click();
  await volViewPage.renderingModuleTab.click();
  await waitForModuleTransitions();
  await field('min').scrollIntoView({ block: 'center', behavior: 'instant' });
  await expect(field('min')).toBeEnabled();
  await expect(field('max')).toBeEnabled();
  return views;
}

async function appliedWindow() {
  const minimum = Number(await field('min').getAttribute('title'));
  const maximum = Number(await field('max').getAttribute('title'));
  return { width: maximum - minimum, level: (maximum + minimum) / 2 };
}

async function setLayersRange(minimum: number, maximum: number) {
  await setValueVueInput(field('min'), String(minimum));
  await setValueVueInput(field('max'), String(maximum));
  await browser.keys('Enter');
}

async function expectLayersWindow(view: WebdriverIO.Element) {
  const layers = await appliedWindow();
  const toolbar = await getEnFaceWindow(view);
  expect(layers.width).toBeCloseTo(toolbar.width, 8);
  expect(layers.level).toBeCloseTo(toolbar.level, 8);
  return toolbar;
}

async function expectProjectionGray(
  view: WebdriverIO.Element,
  window: { width: number; level: number },
  inverted = false,
  projectedValue = 1551 / 9
) {
  const value = Math.min(
    255,
    Math.max(
      0,
      Math.round(((projectedValue - window.level) / window.width + 0.5) * 255)
    )
  );
  const expected = inverted ? 255 - value : value;
  await browser.waitUntil(async () => {
    const pixel = await enFacePixel(4, 3, { x: 0, y: 0 }, view);
    return pixel
      .slice(0, 3)
      .every((channel) => Math.abs(channel - expected) <= 1);
  });
}

async function resetLayersContrast() {
  await $('[data-testid="base-image-contrast"]').click();
  const reset = $('.v-overlay--active [data-testid="reset-contrast"]');
  await expect(reset).toHaveText(/reset contrast/i);
  await reset.scrollIntoView({ block: 'center', behavior: 'instant' });
  await reset.click();
  await browser.keys('Escape');
}

async function chooseLayersAuto() {
  await $('[data-testid="base-image-contrast"]').click();
  const radio = $(
    '.v-overlay--active .v-radio:has(input[value="LowContrast"]) .v-selection-control__input'
  );
  await radio.scrollIntoView({ block: 'center', inline: 'nearest' });
  await radio.waitForStable();
  await radio.click();
  await browser.keys('Escape');
}

async function mouseWindow(view: WebdriverIO.Element) {
  await view.$(CANVAS).click();
  await $('button[data-testid^="control-button-Window & Level "]').click();
  await $('.v-overlay--active .manual-inputs').waitForDisplayed();
  await browser.keys('Escape');
  const before = await appliedWindow();
  await dragContrast(await view.$(CANVAS).getElement(), 30, 20);
  await browser.waitUntil(async () => {
    const after = await appliedWindow();
    return after.width !== before.width || after.level !== before.level;
  });
  await expectProjectionGray(view, await expectLayersWindow(view));
}

async function openSidebar() {
  const toggle = $('[data-testid="enface-rendering-toggle"]');
  await toggle.scrollIntoView({ block: 'center', behavior: 'instant' });
  await toggle.waitForClickable();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true')
    await toggle.click();
  await $(SIDEBAR).waitForDisplayed();
  await toggle.$('..').waitForStable();
}
describe('Projection Layers display controls', () => {
  useReferenceLines();

  it('edits En face-only contrast from Layers, Auto and mouse with normal manual contrast', async () => {
    const [view] = await openProjectionDisplay();
    await expectLayersWindow(view);
    await observeProjectionRedraw(view);
    await setLayersRange(70, 210);
    expect(await expectLayersWindow(view)).toEqual({ width: 140, level: 140 });
    await expectProjectionGray(view, { width: 140, level: 140 });
    await chooseLayersAuto();
    await waitForEnFaceReady(view);
    const automatic = await expectLayersWindow(view);
    expect(automatic.width).toBeLessThan(100);
    await expectProjectionGray(view, automatic);
    await chooseEnFaceProjection('enface-projection-method', 'Sum', view);
    await waitForEnFaceReady(view);
    await expectLayersWindow(view);
    expect(
      Number(
        await $('[data-testid="base-image-range-max-handle"]').getAttribute(
          'aria-valuemax'
        )
      )
    ).toBeGreaterThan(2000);
    await chooseEnFaceProjection('enface-projection-method', 'Mean', view);
    await chooseLayersAuto();
    await waitForEnFaceReady(view);
    await mouseWindow(view);
    const narrow = await requestEnFaceWindow(1e-8, 200, view);
    expect(narrow).toEqual({ width: 1e-8, level: 200 });
    await waitForEnFaceReady(view);
    await expectProjectionGray(view, await expectLayersWindow(view));
    await expect(field('min')).toBeEnabled();
    await expect($('[data-testid="base-image-contrast"]')).toBeEnabled();
    await dragContrast(await view.$(CANVAS).getElement(), 0, -40);
    await waitForEnFaceReady(view);
    const expanded = await expectLayersWindow(view);
    expect(expanded.width).toBeGreaterThan(narrow.width);
    await expectProjectionGray(view, expanded);
    const narrowAgain = await requestEnFaceWindow(1e-8, 200, view);
    expect(narrowAgain).toEqual(narrow);
    await waitForEnFaceReady(view);
    await expectProjectionGray(view, narrowAgain);
    await chooseLayersAuto();
    await waitForEnFaceReady(view);
    await expectProjectionGray(view, await expectLayersWindow(view));
    await expectNoRedrawInterruption(view);
  });

  it('refits manual contrast on projection changes and resets only the selected projection', async () => {
    const [target, peer] = await openProjectionDisplay(true);
    const automaticMean = await expectLayersWindow(target);
    await setEnFaceWindow(300, 150, peer);
    const peerImage = (await enFaceAppearance(peer)).image;
    const source = await $('div[data-testid~="vtk-two-view"]').getElement();
    const sourceWindow = await displayedWindow(source);
    await target.$(CANVAS).click();
    await setLayersRange(70, 210);
    await chooseEnFaceProjection('enface-projection-method', 'Sum', target);
    const automaticSum = await expectLayersWindow(target);
    expect(automaticSum.width).toBeCloseTo(automaticMean.width * 9, 8);
    expect(automaticSum.level).toBeCloseTo(automaticMean.level * 9, 8);
    await expectProjectionGray(target, automaticSum, false, 1551);
    await chooseEnFaceProjection('enface-projection-method', 'Mean', target);
    expect(await expectLayersWindow(target)).toEqual(automaticMean);
    await expectProjectionGray(target, automaticMean);

    const defaultMinimum = await field('min').getValue();
    const defaultMaximum = await field('max').getValue();
    await setValueVueInput(field('max'), '-1');
    await expect($('[data-testid="base-image-range-status"]')).toBeDisplayed();
    await openSidebar();
    await expect($(SIDEBAR).$('button*=Reset contrast')).not.toExist();
    await resetLayersContrast();
    await expect(field('min')).toHaveValue(defaultMinimum);
    await expect(field('max')).toHaveValue(defaultMaximum);
    await expect($('[data-testid="base-image-range-status"]')).not.toExist();

    await selectBasePalette('Inverted grayscale');
    await setLayersRange(0, 1);
    await expectProjectionGray(target, { width: 1, level: 0.5 }, true);
    await $('[data-testid="base-image-visibility"]').click();
    await browser.waitUntil(
      async () => (await enFaceAppearance(target)).visiblePixels === 0
    );
    await resetLayersContrast();
    await expect($('[data-testid="base-image-visibility"]')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Show ')
    );
    expect((await enFaceAppearance(target)).visiblePixels).toBe(0);
    expect(await expectLayersWindow(target)).toEqual(automaticMean);
    await $('[data-testid="base-image-visibility"]').click();
    await expectProjectionGray(target, automaticMean, true);

    await chooseEnFaceProjection('enface-projection-method', 'Sum', target);
    await setLayersRange(0, 1000);
    await setValueVueInput(field('max'), '-1');
    await expect($('[data-testid="base-image-range-status"]')).toBeDisplayed();
    await target.$('[data-testid="enface-controls"]').click();
    await expandEnFaceSection('projection');
    await setSlabRange(1, 3);
    expect(await getEnFaceWindow(target)).toEqual({ width: 1000, level: 500 });
    await expect($(PANEL).$('button*=Reset contrast')).not.toExist();
    await browser.keys('Escape');
    await resetLayersContrast();
    await expect(field('min')).toHaveValue('200');
    await expect(field('max')).toHaveValue('625');
    await expect($('[data-testid="base-image-range-status"]')).not.toExist();
    const slabWindow = await expectLayersWindow(target);
    expect(slabWindow).toEqual({ width: 425, level: 412.5 });
    await expectProjectionGray(target, slabWindow, true, 445);
    await target.$('[data-testid="enface-controls"]').click();
    await expandEnFaceSection('projection');
    await setSlabRange(0, 4);
    await browser.keys('Escape');
    expect(await expectLayersWindow(target)).toEqual(automaticSum);
    await expectProjectionGray(target, automaticSum, true, 1551);
    await expect($('[data-testid="base-image-colormap"]')).toHaveText(
      expect.stringContaining('Inverted grayscale')
    );
    expect(await getEnFaceWindow(peer)).toEqual({ width: 300, level: 150 });
    expect((await enFaceAppearance(peer)).image).toBe(peerImage);
    expect(await displayedWindow(source)).toEqual(sourceWindow);
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('targets the active projection independently and returns Layers to the active source slice', async () => {
    const [target, peer] = await openProjectionDisplay(true);
    await setEnFaceWindow(300, 150, peer);
    const peerWindow = await getEnFaceWindow(peer);
    const peerImage = (await enFaceAppearance(peer)).image;
    const source = await $('div[data-testid~="vtk-two-view"]').getElement();
    const sourceWindow = await displayedWindow(source);
    const sourceCanvas = await source.$('canvas').getElement();
    const sourceImage = (await canvasAppearance(sourceCanvas)).image;
    await target.$(CANVAS).click();
    await expectLayersWindow(target);
    await setLayersRange(70, 210);
    expect(await expectLayersWindow(target)).toEqual({
      width: 140,
      level: 140,
    });
    await expectProjectionGray(target, { width: 140, level: 140 });
    await mouseWindow(target);
    const targetWindow = await getEnFaceWindow(target);
    const targetImage = (await enFaceAppearance(target)).image;
    expect(await getEnFaceWindow(peer)).toEqual(peerWindow);
    expect((await enFaceAppearance(peer)).image).toBe(peerImage);
    expect(await displayedWindow(source)).toEqual(sourceWindow);
    expect((await canvasAppearance(sourceCanvas)).image).toBe(sourceImage);

    await sourceCanvas.click();
    expect(await appliedWindow()).toEqual(sourceWindow);
    await setLayersRange(0, 600);
    expect(await displayedWindow(source)).toEqual({ width: 600, level: 300 });
    expect(await getEnFaceWindow(target)).toEqual(targetWindow);
    expect((await enFaceAppearance(target)).image).toBe(targetImage);
    expect(await getEnFaceWindow(peer)).toEqual(peerWindow);
    expect((await enFaceAppearance(peer)).image).toBe(peerImage);
  });

  it('shares active En face settings between the Rendering sidebar and popup', async () => {
    await browser.setWindowSize(1400, 1000);
    const [target, peer] = await openProjectionDisplay(true);
    await setEnFaceWindow(300, 150, peer);
    await setEnFaceWindow(1000, 500, target);
    const meanImage = (await enFaceAppearance(target)).image;
    const peerImage = (await enFaceAppearance(peer)).image;
    await openSidebar();
    expect(
      await $('[data-testid="enface-rendering-section"]').execute(
        (section) => section.parentElement?.lastElementChild === section
      )
    ).toBe(true);
    await expect($(ENFACE_SELECTOR).$('input')).toHaveValue(
      'En face 1 (source.nrrd)'
    );
    await selectSetting('enface-projection-method', 'Maximum', SIDEBAR);
    await browser.waitUntil(
      async () => (await enFaceAppearance(target)).image !== meanImage
    );
    expect((await enFaceAppearance(peer)).image).toBe(peerImage);
    await target.$('[data-testid="enface-controls"]').click();
    await $(PANEL).waitForDisplayed();
    await expect(
      $(PANEL).$('[data-testid="enface-projection-method"] input')
    ).toHaveValue('Maximum');
    await selectSetting('enface-projection-axis', 'Axial');
    await expandEnFaceSection('projection');
    await setSlabRange(1, 3);
    await browser.keys('Escape');
    await $(PANEL).waitForDisplayed({ reverse: true });
    await expect(
      $(SIDEBAR).$('[data-testid="enface-projection-axis"] input')
    ).toHaveValue('Axial');
    for (const [bound, value] of [
      ['start', '1'],
      ['end', '3'],
    ]) {
      await expect(
        $(SIDEBAR).$(
          '[data-testid="enface-slab-range"] [role="slider"][aria-label="Slab ' +
            bound +
            '"]'
        )
      ).toHaveAttribute('aria-valuenow', value);
    }
    const targetWindow = await getEnFaceWindow(target);
    await peer.$(CANVAS).click();
    await openSidebar();
    await expect($(ENFACE_SELECTOR).$('input')).toHaveValue(
      'En face 2 (source.nrrd)'
    );
    await expect(
      $(SIDEBAR).$('[data-testid="enface-projection-method"] input')
    ).toHaveValue('Mean');
    await expect(
      $(SIDEBAR).$('[data-testid="enface-projection-axis"] input')
    ).toHaveValue('Coronal');
    await selectSetting('enface-projection-method', 'Sum', SIDEBAR);
    await waitForEnFaceReady(peer);
    const peerWindow = await getEnFaceWindow(peer);
    const source = await $('div[data-testid~="vtk-two-view"]').getElement();
    const sourceWindow = await displayedWindow(source);
    await source.$('canvas').click();
    await openSidebar();
    await expect($(ENFACE_SELECTOR).$('input')).toHaveValue(
      'En face 2 (source.nrrd)'
    );
    await expect(
      $(SIDEBAR).$('[data-testid="enface-projection-method"] input')
    ).toHaveValue('Sum');
    expect(await appliedWindow()).toEqual(sourceWindow);
    const peerSumImage = (await enFaceAppearance(peer)).image;
    await selectSetting(
      'enface-view-selector',
      'En face 1 (source.nrrd)',
      SECTION
    );
    expect(
      await target.execute(
        (element) =>
          getComputedStyle(element.closest('.grid-item')!).borderTopColor
      )
    ).toBe('rgb(60, 179, 113)');
    expect(await appliedWindow()).toEqual(targetWindow);
    expect((await enFaceAppearance(peer)).image).toBe(peerSumImage);
    await openSidebar();
    await expect(
      $(SIDEBAR).$('[data-testid="enface-projection-method"] input')
    ).toHaveValue('Maximum');
    await expect(
      $(SIDEBAR).$('[data-testid="enface-projection-axis"] input')
    ).toHaveValue('Axial');
    await peer.$(CANVAS).click();
    await expect($(ENFACE_SELECTOR).$('input')).toHaveValue(
      'En face 2 (source.nrrd)'
    );
    await expect(
      $(SIDEBAR).$('[data-testid="enface-projection-method"] input')
    ).toHaveValue('Sum');
    expect(await appliedWindow()).toEqual(peerWindow);
    await peer.$('[data-testid="enface-controls"]').click();
    await $(PANEL).waitForDisplayed();
    await expect(
      $(PANEL).$('[data-testid="enface-projection-method"] input')
    ).toHaveValue('Sum');
    await browser.keys('Escape');
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('keeps sole En face controls available from an empty active view and hides them when no En face is visible', async () => {
    stageProjectionContrastVolume(makeTempDir(STEM));
    await writeManifestToFile(
      {
        version: '7.0.0',
        dataSources: [{ id: 0, type: 'uri', uri: `/tmp/${STEM}/source.nrrd` }],
        datasets: [{ id: 'source', dataSourceId: 0 }],
        layout: {
          direction: 'row',
          items: [0, 1].map((slotIndex) => ({ type: 'slot', slotIndex })),
        },
        layoutSlots: ['empty', 'enface'],
        activeView: 'empty',
        viewByID: {
          empty: {
            id: 'empty',
            type: '2D',
            name: 'Axial',
            dataID: null,
            options: { orientation: 'Axial' },
          },
          enface: {
            id: 'enface',
            type: 'EnFace',
            name: 'En face',
            dataID: 'source',
            options: {},
          },
        },
      },
      `${STEM}-empty.volview.json`
    );
    await openVolViewPage(`${STEM}-empty.volview.json`);
    await waitForEnFaceReady();
    const emptyOverlay = $(
      '.grid-item:has([data-testid~="vtk-two-view"]) > .overlay'
    );
    await expect(emptyOverlay).toBeDisplayed();
    expect(
      await emptyOverlay.execute(
        (element) =>
          getComputedStyle(element.closest('.grid-item')!).borderTopColor
      )
    ).toBe('rgb(60, 179, 113)');
    const initialImage = (await enFaceAppearance()).image;
    await volViewPage.renderingModuleTab.click();
    await waitForModuleTransitions();
    await openSidebar();
    await expect($(ENFACE_SELECTOR)).not.toExist();
    await expect(field('min')).not.toExist();
    await expect(
      $(SIDEBAR).$('[data-testid="enface-projection-method"] input')
    ).toBeEnabled();
    await selectSetting('enface-projection-method', 'Maximum', SIDEBAR);
    await browser.waitUntil(
      async () => (await enFaceAppearance()).image !== initialImage
    );
    await emptyOverlay.doubleClick();
    await expect($(VIEWER)).not.toExist();
    await expect($(SECTION)).not.toExist();
    await expect($(ENFACE_SELECTOR)).not.toExist();
    await expect($('.v-window-item--active')).not.toHaveText(
      expect.stringContaining('En face')
    );
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('renders the selected palette and preserves hidden appearance through save and restore', async () => {
    const [view] = await openProjectionDisplay();
    await observeProjectionRedraw(view);
    await setLayersRange(0, 600);
    await expectProjectionGray(view, { width: 600, level: 300 });
    await selectBasePalette('Inverted grayscale');
    await expectProjectionGray(view, { width: 600, level: 300 }, true);
    await selectBasePalette('DICOM Hot Iron');
    await browser.waitUntil(async () => {
      const pixel = await enFacePixel(4, 3, { x: 0, y: 0 }, view);
      return (
        Math.max(...pixel.slice(0, 3)) - Math.min(...pixel.slice(0, 3)) > 30
      );
    });
    await expectNoRedrawInterruption(view);
    const colored = (await enFaceAppearance(view)).image;
    await $('[data-testid="base-image-visibility"]').click();
    await browser.waitUntil(
      async () => (await enFaceAppearance(view)).visiblePixels === 0
    );
    await expect(view).toHaveAttribute('aria-busy', 'false');
    await expect(field('min')).toBeEnabled();
    const saved = await volViewPage.saveSession();
    await waitForDownload(path.join(TEMP_DIR, saved), SESSION_SAVE_TIMEOUT);
    await volViewPage.open(`?urls=[tmp/${saved}]`);
    const restored = await $(VIEWER).getElement();
    await restored.waitForDisplayed();
    await volViewPage.renderingModuleTab.click();
    await waitForModuleTransitions();
    await expect(field('min')).toBeEnabled();
    await expect(restored).toHaveAttribute('aria-busy', 'false');
    await expect($('[data-testid="base-image-colormap"]')).toHaveText(
      expect.stringContaining('DICOM Hot Iron')
    );
    await expect($('[data-testid="base-image-visibility"]')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Show ')
    );
    expect(await appliedWindow()).toEqual({ width: 600, level: 300 });
    expect((await enFaceAppearance(restored)).visiblePixels).toBe(0);
    await $('[data-testid="base-image-visibility"]').click();
    await waitForEnFaceReady(restored);
    await browser.waitUntil(
      async () => (await enFaceAppearance(restored)).image === colored
    );
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });
});
