import type { Locator, Page } from '@playwright/test';
import { test, expect, useReferenceLines } from '../fixtures';
import {
  containsText,
  setValueVueInput,
  type VolViewPage,
} from '../pageobjects/volview.page';
import {
  canvasAppearance,
  displayedWindow,
  windowedGray,
  CANVAS,
  VIEWER,
  PANEL,
  MENU_PANEL,
  SIDEBAR,
  type OctUtils,
} from './octTestUtils';
import { stageProjectionContrastVolume } from './projectionTestUtils';
import {
  expectNoRedrawInterruption,
  observeProjectionRedraw,
} from './slabContrastTestUtils';
import type { Utils } from './utils';

const STEM = 'projection-display-controls';
const SECTION = '[data-testid="enface-rendering-section"]';
const ENFACE_SELECTOR = '[data-testid="enface-view-selector"]';

const createDisplayHelpers = ({
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
  const field = (endpoint: 'min' | 'max') =>
    page.locator(`[data-testid="base-image-range-${endpoint}"] input`);

  async function openProjectionDisplay(mixed = false) {
    stageProjectionContrastVolume(utils.makeTempDir(STEM));
    await utils.writeManifestToFile(
      {
        layouts: {
          Projection: [mixed ? ['axial', 'enface', 'enface'] : ['enface']],
        },
      },
      `${STEM}.json`
    );
    await volview.open(`?urls=[tmp/${STEM}.json,tmp/${STEM}/source.nrrd]`);
    await expect(page.locator(VIEWER)).toHaveCount(mixed ? 2 : 1);
    const views = Array.from({ length: mixed ? 2 : 1 }, (_, index) =>
      page.locator(VIEWER).nth(index)
    );
    for (const view of views) await oct.waitForEnFaceReady(view);
    await views[0].locator(CANVAS).click();
    await volview.renderingModuleTab.click();
    await utils.waitForModuleTransitions();
    await field('min').evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
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
    await page.keyboard.press('Enter');
  }

  async function expectLayersWindow(view: Locator) {
    const layers = await appliedWindow();
    const toolbar = await oct.getEnFaceWindow(view);
    expect(layers.width).toBeCloseTo(toolbar.width, 8);
    expect(layers.level).toBeCloseTo(toolbar.level, 8);
    return toolbar;
  }

  async function expectProjectionGray(
    view: Locator,
    window: { width: number; level: number },
    inverted = false,
    projectedValue = 1551 / 9
  ) {
    const value = windowedGray(projectedValue, window);
    const expected = inverted ? 255 - value : value;
    await oct.expectEnFacePixel(expected, [4, 3], view);
  }

  async function resetLayersContrast() {
    await page.locator('[data-testid="base-image-contrast"]').click();
    const reset = page.locator(
      '.v-overlay--active [data-testid="reset-contrast"]'
    );
    await expect(reset).toHaveText(/reset contrast/i);
    await reset.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await reset.click();
    await page.keyboard.press('Escape');
  }

  async function chooseLayersAuto() {
    await page.locator('[data-testid="base-image-contrast"]').click();
    const radio = page.locator(
      '.v-overlay--active .v-radio:has(input[value="LowContrast"]) .v-selection-control__input'
    );
    await radio.evaluate((element) =>
      element.scrollIntoView({ block: 'center', inline: 'nearest' })
    );
    await radio.click();
    await page.keyboard.press('Escape');
  }

  async function mouseWindow(view: Locator) {
    await view.locator(CANVAS).click();
    await page
      .locator('button[data-testid^="control-button-Window & Level "]')
      .click();
    await expect(
      page.locator('.v-overlay--active .manual-inputs')
    ).toBeVisible();
    await page.keyboard.press('Escape');
    const before = await appliedWindow();
    await oct.dragContrast(view.locator(CANVAS), 30, 20);
    await expect
      .poll(async () => {
        const after = await appliedWindow();
        return after.width !== before.width || after.level !== before.level;
      })
      .toBe(true);
    await expectProjectionGray(view, await expectLayersWindow(view));
  }

  return {
    field,
    openProjectionDisplay,
    appliedWindow,
    setLayersRange,
    expectLayersWindow,
    expectProjectionGray,
    resetLayersContrast,
    chooseLayersAuto,
    mouseWindow,
    openSidebar: oct.expandEnFaceSidebar,
  };
};

test.describe('Projection Layers display controls', () => {
  useReferenceLines();

  test('edits En face-only contrast from Layers, Auto and mouse with normal manual contrast', async ({
    page,
    volview,
    utils,
    oct,
    slabContrast,
  }) => {
    const {
      field,
      openProjectionDisplay,
      setLayersRange,
      expectLayersWindow,
      expectProjectionGray,
      chooseLayersAuto,
      mouseWindow,
    } = createDisplayHelpers({ page, volview, utils, oct });
    const [view] = await openProjectionDisplay();
    await expectLayersWindow(view);
    await observeProjectionRedraw(view);
    await setLayersRange(70, 210);
    expect(await expectLayersWindow(view)).toEqual({ width: 140, level: 140 });
    await expectProjectionGray(view, { width: 140, level: 140 });
    await chooseLayersAuto();
    await oct.waitForEnFaceReady(view);
    const automatic = await expectLayersWindow(view);
    expect(automatic.width).toBeLessThan(100);
    await expectProjectionGray(view, automatic);
    await oct.chooseEnFaceProjection('enface-projection-method', 'Sum', view);
    await oct.waitForEnFaceReady(view);
    await expectLayersWindow(view);
    expect(
      Number(
        await page
          .locator('[data-testid="base-image-range-max-handle"]')
          .getAttribute('aria-valuemax')
      )
    ).toBeGreaterThan(2000);
    await oct.chooseEnFaceProjection('enface-projection-method', 'Mean', view);
    await chooseLayersAuto();
    await oct.waitForEnFaceReady(view);
    await mouseWindow(view);
    const narrow = await slabContrast.requestEnFaceWindow(1e-8, 200, view);
    expect(narrow).toEqual({ width: 1e-8, level: 200 });
    await oct.waitForEnFaceReady(view);
    await expectProjectionGray(view, await expectLayersWindow(view));
    await expect(field('min')).toBeEnabled();
    await expect(
      page.locator('[data-testid="base-image-contrast"]')
    ).toBeEnabled();
    await oct.dragContrast(view.locator(CANVAS), 0, -40);
    await oct.waitForEnFaceReady(view);
    const expanded = await expectLayersWindow(view);
    expect(expanded.width).toBeGreaterThan(narrow.width);
    await expectProjectionGray(view, expanded);
    const narrowAgain = await slabContrast.requestEnFaceWindow(1e-8, 200, view);
    expect(narrowAgain).toEqual(narrow);
    await oct.waitForEnFaceReady(view);
    await expectProjectionGray(view, narrowAgain);
    await chooseLayersAuto();
    await oct.waitForEnFaceReady(view);
    await expectProjectionGray(view, await expectLayersWindow(view));
    await expectNoRedrawInterruption(view);
  });

  test('refits manual contrast on projection changes and resets only the selected projection', async ({
    page,
    volview,
    utils,
    oct,
    layerDisplay,
  }) => {
    const {
      field,
      openProjectionDisplay,
      setLayersRange,
      expectLayersWindow,
      expectProjectionGray,
      resetLayersContrast,
      openSidebar,
    } = createDisplayHelpers({ page, volview, utils, oct });
    const [target, peer] = await openProjectionDisplay(true);
    const automaticMean = await expectLayersWindow(target);
    await oct.setEnFaceWindow(300, 150, peer);
    const peerImage = (await oct.enFaceAppearance(peer)).image;
    const source = page.locator('div[data-testid~="vtk-two-view"]').first();
    const sourceWindow = await displayedWindow(source);
    await target.locator(CANVAS).click();
    await setLayersRange(70, 210);
    await oct.chooseEnFaceProjection('enface-projection-method', 'Sum', target);
    const automaticSum = await expectLayersWindow(target);
    expect(automaticSum.width).toBeCloseTo(automaticMean.width * 9, 8);
    expect(automaticSum.level).toBeCloseTo(automaticMean.level * 9, 8);
    await expectProjectionGray(target, automaticSum, false, 1551);
    await oct.chooseEnFaceProjection(
      'enface-projection-method',
      'Mean',
      target
    );
    expect(await expectLayersWindow(target)).toEqual(automaticMean);
    await expectProjectionGray(target, automaticMean);

    const defaultMinimum = await field('min').inputValue();
    const defaultMaximum = await field('max').inputValue();
    await setValueVueInput(field('max'), '-1');
    const rangeStatus = page.locator('[data-testid="base-image-range-status"]');
    await expect(rangeStatus).toBeVisible();
    await openSidebar();
    await expect(
      page
        .locator(SIDEBAR)
        .locator('button', { hasText: containsText('Reset contrast') })
    ).not.toBeAttached();
    await resetLayersContrast();
    await expect(field('min')).toHaveValue(defaultMinimum);
    await expect(field('max')).toHaveValue(defaultMaximum);
    await expect(rangeStatus).not.toBeAttached();

    await layerDisplay.selectBasePalette('Inverted grayscale');
    await setLayersRange(0, 1);
    await expectProjectionGray(target, { width: 1, level: 0.5 }, true);
    const visibility = page.locator('[data-testid="base-image-visibility"]');
    await visibility.click();
    await expect
      .poll(async () => (await oct.enFaceAppearance(target)).visiblePixels)
      .toBe(0);
    await resetLayersContrast();
    await expect(visibility).toHaveAttribute(
      'aria-label',
      containsText('Show ')
    );
    expect((await oct.enFaceAppearance(target)).visiblePixels).toBe(0);
    expect(await expectLayersWindow(target)).toEqual(automaticMean);
    await visibility.click();
    await expectProjectionGray(target, automaticMean, true);

    await oct.chooseEnFaceProjection('enface-projection-method', 'Sum', target);
    await setLayersRange(0, 1000);
    await setValueVueInput(field('max'), '-1');
    await expect(rangeStatus).toBeVisible();
    await oct.openEnFaceProjection(target);
    await oct.setSlabRange(1, 3);
    expect(await oct.getEnFaceWindow(target)).toEqual({
      width: 1000,
      level: 500,
    });
    await expect(
      page
        .locator(PANEL)
        .locator('button', { hasText: containsText('Reset contrast') })
    ).not.toBeAttached();
    await page.keyboard.press('Escape');
    await resetLayersContrast();
    await expect(field('min')).toHaveValue('200');
    await expect(field('max')).toHaveValue('625');
    await expect(rangeStatus).not.toBeAttached();
    const slabWindow = await expectLayersWindow(target);
    expect(slabWindow).toEqual({ width: 425, level: 412.5 });
    await expectProjectionGray(target, slabWindow, true, 445);
    await oct.setEnFaceSlab(0, 4, target);
    expect(await expectLayersWindow(target)).toEqual(automaticSum);
    await expectProjectionGray(target, automaticSum, true, 1551);
    await expect(
      page.locator('[data-testid="base-image-colormap"]')
    ).toContainText('Inverted grayscale');
    expect(await oct.getEnFaceWindow(peer)).toEqual({
      width: 300,
      level: 150,
    });
    expect((await oct.enFaceAppearance(peer)).image).toBe(peerImage);
    expect(await displayedWindow(source)).toEqual(sourceWindow);
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('targets the active projection independently and returns Layers to the active source slice', async ({
    page,
    volview,
    utils,
    oct,
  }) => {
    const {
      openProjectionDisplay,
      appliedWindow,
      setLayersRange,
      expectLayersWindow,
      expectProjectionGray,
      mouseWindow,
    } = createDisplayHelpers({ page, volview, utils, oct });
    const [target, peer] = await openProjectionDisplay(true);
    await oct.setEnFaceWindow(300, 150, peer);
    const peerWindow = await oct.getEnFaceWindow(peer);
    const peerImage = (await oct.enFaceAppearance(peer)).image;
    const source = page.locator('div[data-testid~="vtk-two-view"]').first();
    const sourceWindow = await displayedWindow(source);
    const sourceCanvas = source.locator('canvas');
    const sourceImage = (await canvasAppearance(sourceCanvas)).image;
    await target.locator(CANVAS).click();
    await expectLayersWindow(target);
    await setLayersRange(70, 210);
    expect(await expectLayersWindow(target)).toEqual({
      width: 140,
      level: 140,
    });
    await expectProjectionGray(target, { width: 140, level: 140 });
    await mouseWindow(target);
    const targetWindow = await oct.getEnFaceWindow(target);
    const targetImage = (await oct.enFaceAppearance(target)).image;
    expect(await oct.getEnFaceWindow(peer)).toEqual(peerWindow);
    expect((await oct.enFaceAppearance(peer)).image).toBe(peerImage);
    expect(await displayedWindow(source)).toEqual(sourceWindow);
    expect((await canvasAppearance(sourceCanvas)).image).toBe(sourceImage);

    await sourceCanvas.click();
    expect(await appliedWindow()).toEqual(sourceWindow);
    await setLayersRange(0, 600);
    expect(await displayedWindow(source)).toEqual({ width: 600, level: 300 });
    expect(await oct.getEnFaceWindow(target)).toEqual(targetWindow);
    expect((await oct.enFaceAppearance(target)).image).toBe(targetImage);
    expect(await oct.getEnFaceWindow(peer)).toEqual(peerWindow);
    expect((await oct.enFaceAppearance(peer)).image).toBe(peerImage);
  });

  test('shares active En face settings between the Rendering sidebar and popup', async ({
    page,
    volview,
    utils,
    oct,
  }) => {
    const { openProjectionDisplay, appliedWindow, openSidebar } =
      createDisplayHelpers({ page, volview, utils, oct });
    await page.setViewportSize({ width: 1400, height: 1000 });
    const [target, peer] = await openProjectionDisplay(true);
    await oct.setEnFaceWindow(300, 150, peer);
    await oct.setEnFaceWindow(1000, 500, target);
    const meanImage = (await oct.enFaceAppearance(target)).image;
    const peerImage = (await oct.enFaceAppearance(peer)).image;
    const sidebar = page.locator(SIDEBAR);
    const enFaceSelector = page.locator(ENFACE_SELECTOR).locator('input');
    await openSidebar();
    expect(
      await page
        .locator('[data-testid="enface-rendering-section"]')
        .evaluate(
          (section) => section.parentElement?.lastElementChild === section
        )
    ).toBe(true);
    await expect(enFaceSelector).toHaveValue('En face 1 (source.nrrd)');
    await oct.selectSetting('enface-projection-method', 'Maximum', SIDEBAR);
    await expect
      .poll(async () => (await oct.enFaceAppearance(target)).image)
      .not.toBe(meanImage);
    expect((await oct.enFaceAppearance(peer)).image).toBe(peerImage);
    await oct.openEnFaceControls(target);
    await expect(
      page
        .locator(PANEL)
        .locator('[data-testid="enface-projection-method"] input')
    ).toHaveValue('Maximum');
    await oct.selectSetting('enface-projection-axis', 'Axial');
    await oct.expandEnFaceSection();
    await oct.setSlabRange(1, 3);
    await page.keyboard.press('Escape');
    await expect(page.locator(MENU_PANEL)).toBeHidden();
    await expect(
      sidebar.locator('[data-testid="enface-projection-axis"] input')
    ).toHaveValue('Axial');
    for (const [bound, value] of [
      ['start', '1'],
      ['end', '3'],
    ]) {
      await expect(
        sidebar.locator(
          '[data-testid="enface-slab-range"] [role="slider"][aria-label="Slab ' +
            bound +
            '"]'
        )
      ).toHaveAttribute('aria-valuenow', value);
    }
    const targetWindow = await oct.getEnFaceWindow(target);
    await peer.locator(CANVAS).click();
    await openSidebar();
    await expect(enFaceSelector).toHaveValue('En face 2 (source.nrrd)');
    await expect(
      sidebar.locator('[data-testid="enface-projection-method"] input')
    ).toHaveValue('Mean');
    await expect(
      sidebar.locator('[data-testid="enface-projection-axis"] input')
    ).toHaveValue('Coronal');
    await oct.selectSetting('enface-projection-method', 'Sum', SIDEBAR);
    await oct.waitForEnFaceReady(peer);
    const peerWindow = await oct.getEnFaceWindow(peer);
    const source = page.locator('div[data-testid~="vtk-two-view"]').first();
    const sourceWindow = await displayedWindow(source);
    await source.locator('canvas').click();
    await openSidebar();
    await expect(enFaceSelector).toHaveValue('En face 2 (source.nrrd)');
    await expect(
      sidebar.locator('[data-testid="enface-projection-method"] input')
    ).toHaveValue('Sum');
    expect(await appliedWindow()).toEqual(sourceWindow);
    const peerSumImage = (await oct.enFaceAppearance(peer)).image;
    await oct.selectSetting(
      'enface-view-selector',
      'En face 1 (source.nrrd)',
      SECTION
    );
    expect(
      await target.evaluate(
        (element) =>
          getComputedStyle(element.closest('.grid-item')!).borderTopColor
      )
    ).toBe('rgb(60, 179, 113)');
    expect(await appliedWindow()).toEqual(targetWindow);
    expect((await oct.enFaceAppearance(peer)).image).toBe(peerSumImage);
    await openSidebar();
    await expect(
      sidebar.locator('[data-testid="enface-projection-method"] input')
    ).toHaveValue('Maximum');
    await expect(
      sidebar.locator('[data-testid="enface-projection-axis"] input')
    ).toHaveValue('Axial');
    await peer.locator(CANVAS).click();
    await expect(enFaceSelector).toHaveValue('En face 2 (source.nrrd)');
    await expect(
      sidebar.locator('[data-testid="enface-projection-method"] input')
    ).toHaveValue('Sum');
    expect(await appliedWindow()).toEqual(peerWindow);
    await oct.openEnFaceControls(peer);
    await expect(
      page
        .locator(PANEL)
        .locator('[data-testid="enface-projection-method"] input')
    ).toHaveValue('Sum');
    await page.keyboard.press('Escape');
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('keeps sole En face controls available from an empty active view and hides them when no En face is visible', async ({
    page,
    volview,
    utils,
    oct,
  }) => {
    const { field, expectProjectionGray, openSidebar } = createDisplayHelpers({
      page,
      volview,
      utils,
      oct,
    });
    stageProjectionContrastVolume(utils.makeTempDir(STEM));
    await utils.writeManifestToFile(
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
            config: {
              source: { window: { auto: 'FullRange', useAuto: true } },
            },
          },
        },
      },
      `${STEM}-empty.volview.json`
    );
    await utils.openVolViewPage(`${STEM}-empty.volview.json`);
    await oct.waitForEnFaceReady();
    const emptyOverlay = page.locator(
      '.grid-item:has([data-testid~="vtk-two-view"]) > .overlay'
    );
    await expect(emptyOverlay).toBeVisible();
    expect(
      await emptyOverlay.evaluate(
        (element) =>
          getComputedStyle(element.closest('.grid-item')!).borderTopColor
      )
    ).toBe('rgb(60, 179, 113)');
    const view = page.locator(VIEWER).first();
    const contrast = { width: 565, level: 302.5 };
    await expectProjectionGray(view, contrast);
    const initialImage = (await oct.enFaceAppearance()).image;
    await volview.renderingModuleTab.click();
    await utils.waitForModuleTransitions();
    await openSidebar();
    await expect(page.locator(ENFACE_SELECTOR)).not.toBeAttached();
    await expect(field('min')).not.toBeAttached();
    await expect(
      page
        .locator(SIDEBAR)
        .locator('[data-testid="enface-projection-method"] input')
    ).toBeEnabled();
    await oct.selectSetting('enface-projection-method', 'Maximum', SIDEBAR);
    await expectProjectionGray(view, contrast, false, 549);
    await expect
      .poll(async () => (await oct.enFaceAppearance()).image)
      .not.toBe(initialImage);
    await emptyOverlay.dblclick();
    await expect(page.locator(VIEWER)).not.toBeAttached();
    await expect(page.locator(SECTION)).not.toBeAttached();
    await expect(page.locator(ENFACE_SELECTOR)).not.toBeAttached();
    await expect(page.locator('.v-window-item--active')).not.toContainText(
      'En face'
    );
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('renders the selected palette and preserves hidden appearance through save and restore', async ({
    page,
    volview,
    utils,
    oct,
    layerDisplay,
  }) => {
    const {
      field,
      openProjectionDisplay,
      appliedWindow,
      setLayersRange,
      expectProjectionGray,
    } = createDisplayHelpers({ page, volview, utils, oct });
    const [view] = await openProjectionDisplay();
    await observeProjectionRedraw(view);
    await setLayersRange(0, 600);
    await expectProjectionGray(view, { width: 600, level: 300 });
    await layerDisplay.selectBasePalette('Inverted grayscale');
    await expectProjectionGray(view, { width: 600, level: 300 }, true);
    await layerDisplay.selectBasePalette('DICOM Hot Iron');
    await expect
      .poll(async () => {
        const pixel = await oct.enFacePixel(4, 3, { x: 0, y: 0 }, view);
        return (
          Math.max(...pixel.slice(0, 3)) - Math.min(...pixel.slice(0, 3)) > 30
        );
      })
      .toBe(true);
    await expectNoRedrawInterruption(view);
    const colored = (await oct.enFaceAppearance(view)).image;
    const visibility = page.locator('[data-testid="base-image-visibility"]');
    await visibility.click();
    await expect
      .poll(async () => (await oct.enFaceAppearance(view)).visiblePixels)
      .toBe(0);
    await expect(view).toHaveAttribute('aria-busy', 'false');
    await expect(field('min')).toBeEnabled();
    const saved = await volview.saveSession();
    await volview.open(`?urls=[tmp/${saved}]`);
    const restored = page.locator(VIEWER).first();
    await expect(restored).toBeVisible();
    await volview.renderingModuleTab.click();
    await utils.waitForModuleTransitions();
    await expect(field('min')).toBeEnabled();
    await expect(restored).toHaveAttribute('aria-busy', 'false');
    await expect(
      page.locator('[data-testid="base-image-colormap"]')
    ).toContainText('DICOM Hot Iron');
    await expect(visibility).toHaveAttribute(
      'aria-label',
      containsText('Show ')
    );
    expect(await appliedWindow()).toEqual({ width: 600, level: 300 });
    expect((await oct.enFaceAppearance(restored)).visiblePixels).toBe(0);
    await visibility.click();
    await oct.waitForEnFaceReady(restored);
    await expect
      .poll(async () => (await oct.enFaceAppearance(restored)).image)
      .toBe(colored);
    expect(await volview.getNotificationsCount()).toBe(0);
  });
});
