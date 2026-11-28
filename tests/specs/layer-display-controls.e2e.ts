import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { CONTENT_VIEWPORT, TEMP_DIR } from '../e2eRun';
import {
  containsText,
  holdKey,
  setValueVueInput,
  type VolViewPage,
} from '../pageobjects/volview.page';
import {
  layeredImageManifest,
  type LayerDisplayUtils,
} from './layerDisplayTestUtils';
import type { Utils } from './utils';

const paletteTitles = [
  'Grayscale',
  'Inverted grayscale',
  'DICOM Hot Iron',
  'DICOM PET',
  'DICOM Hot Metal Blue',
  'DICOM Spring',
  'DICOM Winter',
  'Viridis',
  'Cool to Warm',
];

const createDisplayHelpers = ({
  page,
  volview,
  utils,
  layerDisplay,
}: {
  page: Page;
  volview: VolViewPage;
  utils: Utils;
  layerDisplay: LayerDisplayUtils;
}) => {
  const option = (title: string) =>
    page.locator('[role="option"]', { hasText: containsText(title) }).first();
  const moveToHeader = () => utils.moveToElement(page.locator('header'));
  const saveScreenshot = (name: string) =>
    page.screenshot({ path: path.join(TEMP_DIR, name) });

  async function expectPaletteOptions() {
    const options = page.locator('[role="option"]');
    const expected = paletteTitles;
    await expect(options).toHaveCount(expected.length);
    for (const [index, title] of expected.entries()) {
      const item = options.nth(index);
      await item.evaluate((element) =>
        element.scrollIntoView({ block: 'nearest', behavior: 'instant' })
      );
      await expect(item).toHaveText(title);
      await expect(
        item.locator('[data-testid="layer-palette-option-swatch"]')
      ).toHaveAttribute('style', /linear-gradient\(/);
    }
  }

  async function captureViewPixels() {
    return utils.capture2DViewScreenshotMetrics('overlay-capture.png');
  }

  async function windowingLabels() {
    const views = await volview.views2D.all();
    return Promise.all(
      views.map(async (view) => {
        const text = await view.innerText();
        return text.match(/W\/L: [\d.-]+ \/ [\d.-]+/)?.[0];
      })
    );
  }

  async function expectAppliedRange(
    min: string,
    max: string,
    displayedMax = max
  ) {
    await page
      .locator('h4', { hasText: containsText('display-overlay.mha') })
      .first()
      .click();
    await expect(
      page.locator('[data-testid="layer-range-min"] input')
    ).toHaveValue(min);
    await expect(
      page.locator('[data-testid="layer-range-max"] input')
    ).toHaveValue(displayedMax);
    await expect(
      page.locator('[data-testid="layer-range-min"] input')
    ).toHaveAttribute('title', min);
    await expect(
      page.locator('[data-testid="layer-range-max"] input')
    ).toHaveAttribute('title', max);
  }

  async function expectDisplaySettings(
    min: string,
    max: string,
    displayedMax = max
  ) {
    await expectAppliedRange(min, max, displayedMax);
    await expect(page.locator('[data-testid="layer-colormap"]')).toContainText(
      'Cool to Warm'
    );
    await expect(
      page.locator('[data-testid="layer-opacity-slider"] [role="slider"]')
    ).toHaveAttribute('aria-valuenow', '0.5');
    await expect(
      page.locator('[data-testid="layer-transparent-background"] input')
    ).not.toBeChecked();
  }

  async function expectRenderedPixels(
    expected: Awaited<ReturnType<typeof captureViewPixels>>
  ) {
    await moveToHeader();
    await expect
      .poll(
        async () => {
          const pixels = await captureViewPixels();
          return (
            pixels.length === expected.length &&
            pixels.every(
              ({ colored, blue, checksum }, index) =>
                colored === expected[index].colored &&
                blue === expected[index].blue &&
                checksum === expected[index].checksum
            )
          );
        },
        {
          message:
            'Expected matching overlay color counts and intensity sum after replacing views or reopening the session',
        }
      )
      .toBe(true);
  }

  async function openDisplayFixture({
    preset = 'Cool to Warm',
    mappingRange = [-2.75, 100.25],
    opacity = 0.5,
    transparentBackground = false,
    singleSlice = false,
  } = {}) {
    const display = { preset, mappingRange, opacity, transparentBackground };
    const base = utils.writeMetaImage('display-base.mha');
    const overlay = utils.writeMetaImage('display-overlay.mha', { step: 29 });
    const manifest = 'display-controls.json';
    await utils.writeManifestToFile(
      {
        ...layeredImageManifest(base, overlay),
        ...(singleSlice
          ? {
              layout: {
                direction: 'row',
                items: [{ type: 'slot', slotIndex: 0 }],
              },
              layoutSlots: ['axial'],
              activeView: 'axial',
              viewByID: {
                axial: {
                  id: 'axial',
                  type: '2D',
                  name: 'Axial',
                  dataID: 'base',
                  options: { orientation: 'Axial' },
                },
              },
            }
          : {}),
        layerDisplay: {
          'base::overlay': display,
        },
      },
      manifest
    );

    await utils.openVolViewPage(manifest);
    const baseCard = page
      .locator('.image-list-card', { hasText: containsText(base) })
      .first();
    await expect(baseCard).toBeVisible();
    await expect(baseCard).toBeEnabled();
    await baseCard.locator('[data-testid="dataset-menu-button"]').click();
    const showInAllViews = page
      .locator('.v-list-item', { hasText: containsText('Show in all views') })
      .first();
    await showInAllViews.click();
    await page.keyboard.press('Escape');
    await layerDisplay.openLayerDisplayControls();
    await moveToHeader();
    await expect
      .poll(
        async () => {
          const pixels = await captureViewPixels();
          return (
            pixels.length === (singleSlice ? 1 : 3) &&
            pixels.every(({ colored }) => colored > 1000)
          );
        },
        { message: 'Expected the overlay to render in every 2D view' }
      )
      .toBe(true);
  }

  async function openEditedDisplayFixture(singleSlice = false) {
    await openDisplayFixture({
      preset: 'DICOM Hot Iron',
      mappingRange: [0, 255],
      opacity: 0.6,
      singleSlice,
    });
    const select = page.locator('[data-testid="layer-colormap"]');
    await select.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await select.click();
    const coolToWarm = option('Cool to Warm');
    await coolToWarm.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await coolToWarm.click();
    await setValueVueInput(
      page.locator('[data-testid="layer-range-min"] input'),
      '-2.75'
    );
    await setValueVueInput(
      page.locator('[data-testid="layer-range-max"] input'),
      '100.25'
    );
    await page.evaluate(() => {
      document
        .querySelector<HTMLElement>(
          '[data-testid="layer-opacity-slider"] [role="slider"]'
        )!
        .focus();
    });
    await page.keyboard.press('PageDown');
    await expectDisplaySettings('-2.75', '100.25', '100.3');
    await moveToHeader();
    await expect
      .poll(
        async () => {
          const pixels = await captureViewPixels();
          return (
            pixels.length === (singleSlice ? 1 : 3) &&
            pixels.every(({ colored, blue }) => colored > 1000 && blue > 0)
          );
        },
        {
          message: 'Expected the edited Cool to Warm palette in every 2D view',
        }
      )
      .toBe(true);
    const baseWindowing = await windowingLabels();
    expect(baseWindowing.every(Boolean)).toBe(true);
    const appliedPixels = await captureViewPixels();
    return { baseWindowing, appliedPixels };
  }

  async function convertSlicesToVolumes() {
    const count = await volview.views2D.count();
    expect(count).toBeGreaterThan(0);
    for (let remaining = count - 1; remaining >= 0; remaining--) {
      const view = volview.views2D.first();
      await view.locator('.view-type-select').click();
      await option('Volume').click();
      await volview.waitForViewCounts(remaining, true);
    }
  }

  return {
    option,
    moveToHeader,
    saveScreenshot,
    expectPaletteOptions,
    captureViewPixels,
    windowingLabels,
    expectAppliedRange,
    expectDisplaySettings,
    expectRenderedPixels,
    openDisplayFixture,
    openEditedDisplayFixture,
    convertSlicesToVolumes,
  };
};

test.describe('Overlay display controls', () => {
  // Capture and compare at a compact viewport to limit volume rendering work.
  test.use({ viewport: { ...CONTENT_VIEWPORT, height: 400 } });

  for (const { title, preset } of [
    { title: 'missing', preset: undefined },
    { title: 'unknown', preset: 'Unknown palette' },
  ]) {
    test(`uses Hot Iron for a ${title} saved palette`, async ({
      page,
      volview,
      utils,
      layerDisplay,
    }) => {
      const { option } = createDisplayHelpers({
        page,
        volview,
        utils,
        layerDisplay,
      });
      const base = utils.writeMetaImage(`fallback-${title}-base.mha`);
      const overlay = utils.writeMetaImage(`fallback-${title}-overlay.mha`, {
        step: 29,
      });
      const manifest = `fallback-${title}.json`;
      await utils.writeManifestToFile(
        {
          ...layeredImageManifest(base, overlay),
          layerDisplay: {
            'base::overlay': {
              ...(preset === undefined ? {} : { preset }),
              mappingRange: [20, 200],
              opacity: 0.4,
              transparentBackground: false,
            },
          },
        },
        manifest
      );
      await utils.openVolViewPage(manifest);
      await layerDisplay.openLayerDisplayControls();
      const select = page.locator('[data-testid="layer-colormap"]');
      await expect(select).toContainText('DICOM Hot Iron');
      await expect(
        page.locator('[data-testid="layer-range-min"] input')
      ).toHaveValue('20');
      await expect(
        page.locator('[data-testid="layer-range-max"] input')
      ).toHaveValue('200');
      await expect(
        page.locator('[data-testid="layer-opacity-slider"] [role="slider"]')
      ).toHaveAttribute('aria-valuenow', '0.4');
      await expect(
        page.locator('[data-testid="layer-transparent-background"] input')
      ).not.toBeChecked();
      await select.evaluate((element) =>
        element.scrollIntoView({ block: 'center', behavior: 'instant' })
      );
      await select.click();
      await expect(option('DICOM Hot Iron')).toHaveAttribute(
        'aria-selected',
        'true'
      );
      await page.keyboard.press('Escape');
    });
  }

  test('applies palette, opacity and range edits in every view and preserves pixels for invalid drafts', async ({
    page,
    volview,
    utils,
    layerDisplay,
  }) => {
    const {
      option,
      moveToHeader,
      saveScreenshot,
      captureViewPixels,
      windowingLabels,
      expectAppliedRange,
      openDisplayFixture,
    } = createDisplayHelpers({ page, volview, utils, layerDisplay });
    const toasts = page.locator('.Vue-Toastification__toast');
    await openDisplayFixture({
      preset: 'DICOM Hot Iron',
      mappingRange: [0, 255],
      opacity: 1,
      transparentBackground: true,
    });
    const transparent = page.locator(
      '[data-testid="layer-transparent-background"] input'
    );
    await expect(transparent).toBeChecked();
    await expect(toasts).toHaveCount(0);
    await transparent.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await transparent.click();
    await expect(transparent).not.toBeChecked();
    const select = page.locator('[data-testid="layer-colormap"]');
    await expect(select).toContainText('DICOM Hot Iron');
    const rangeSlider = page.locator('[data-testid="layer-range-slider"]');
    for (const name of [
      'Display range minimum',
      'Display range maximum',
      'Display range center',
    ])
      await expect(
        rangeSlider.getByRole('slider', { name, exact: true })
      ).toHaveCount(1);
    await expect(rangeSlider.locator('[role="slider"]')).toHaveCount(3);
    await expect(
      page.locator('[data-testid="layer-opacity-slider"] [role="slider"]')
    ).toHaveAccessibleName('Opacity');
    await expect(toasts).toHaveCount(0);
    await page
      .locator('[data-testid="layer-range-min"] input')
      .evaluate((element) =>
        element.scrollIntoView({ block: 'center', behavior: 'instant' })
      );
    await expect(select).toBeVisible();
    await expect(select).toBeEnabled();
    await page.evaluate(() => {
      document
        .querySelector<HTMLElement>(
          '[data-testid="layer-opacity-slider"] [role="slider"]'
        )!
        .focus();
    });
    await page.keyboard.press('Home');
    await holdKey(page, 'PageUp', 5);
    await expect(
      page.locator('[data-testid="layer-opacity-slider"] [role="slider"]')
    ).toHaveAttribute('aria-valuenow', '0.5');

    expect(await volview.views2D.count()).toBe(3);
    const baseWindowing = await windowingLabels();
    expect(baseWindowing.every(Boolean)).toBe(true);
    await select.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await expect(toasts).toHaveCount(0);
    await select.click();
    await expect(option('DICOM Hot Iron')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    const coolToWarm = option('Cool to Warm');
    await coolToWarm.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await expect(coolToWarm).toBeVisible();
    await expect(coolToWarm).toBeEnabled();
    await expect(
      coolToWarm.locator('[data-testid="layer-palette-option-swatch"]')
    ).toBeVisible();
    await saveScreenshot('overlay-palette-menu.png');
    await coolToWarm.click();
    await expect(select).toContainText('Cool to Warm');
    await expect
      .poll(
        async () => {
          const pixels = await captureViewPixels();
          return pixels.length === 3 && pixels.every(({ blue }) => blue > 1000);
        },
        {
          message: 'Expected palette to change pixels in all three 2D views',
        }
      )
      .toBe(true);

    const beforeRange = await captureViewPixels();
    const rangeMin = page.locator('[data-testid="layer-range-min"] input');
    const rangeMax = page.locator('[data-testid="layer-range-max"] input');
    await rangeMin.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await expect(rangeMin).toBeVisible();
    await expect(rangeMin).toBeEnabled();
    await setValueVueInput(rangeMin, '-2.75');
    await setValueVueInput(rangeMax, '100.25');
    await expectAppliedRange('-2.75', '100.25', '100.3');
    await rangeMax.click();
    await expect(rangeMax).toHaveValue('100.3');
    await expect(rangeMax).toHaveAttribute('title', '100.25');
    await expectAppliedRange('-2.75', '100.25', '100.3');
    await expect
      .poll(
        async () => {
          const after = await captureViewPixels();
          return (
            after.length === 3 &&
            after.every(
              ({ colored, blue, checksum }, index) =>
                colored > 1000 &&
                blue < beforeRange[index].blue &&
                checksum !== beforeRange[index].checksum
            )
          );
        },
        {
          message: 'Expected range to change pixels in all three 2D views',
        }
      )
      .toBe(true);
    await expect(
      page.locator('[data-testid="layer-opacity-slider"] input')
    ).toHaveValue('0.5');
    await expect(
      page.locator('[data-testid="layer-opacity-slider"] [role="slider"]')
    ).toHaveAttribute('aria-valuenow', '0.5');
    await expectAppliedRange('-2.75', '100.25', '100.3');
    expect(await windowingLabels()).toEqual(baseWindowing);
    await moveToHeader();
    const appliedPixels = await captureViewPixels();
    await setValueVueInput(rangeMax, '-3');
    await rangeMax.click();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="layer-range-status"]')).toHaveText(
      'Min must be less than Max.'
    );
    await expect(rangeMin).toHaveAttribute('title', '-2.75');
    await expect(rangeMax).toHaveAttribute('title', '100.25');
    expect(await captureViewPixels()).toEqual(appliedPixels);

    await setValueVueInput(rangeMax, '100.25');
    await setValueVueInput(rangeMin, '0');
    await setValueVueInput(rangeMax, '255');
    await moveToHeader();
    await expectAppliedRange('0', '255');
    await expect(page.locator('[data-testid="layer-colormap"]')).toContainText(
      'Cool to Warm'
    );
    await expect(
      page.locator('[data-testid="layer-opacity-slider"] [role="slider"]')
    ).toHaveAttribute('aria-valuenow', '0.5');
    await expect
      .poll(
        async () => {
          const fullRange = await captureViewPixels();
          return (
            fullRange.length === 3 &&
            fullRange.every(
              ({ blue }, index) => blue === beforeRange[index].blue
            )
          );
        },
        {
          message:
            'Expected entering the full image range to restore the colors in all three views',
        }
      )
      .toBe(true);
    await page.evaluate(() => {
      document
        .querySelector<HTMLElement>('[data-testid="layer-range-max-handle"]')!
        .focus();
    });
    await holdKey(page, 'ArrowDown', 10);
    await expect(rangeMin).toHaveValue('0');
    await expect(rangeMax).toHaveValue('229.5');
    expect(Number(await rangeMax.getAttribute('title'))).toBeCloseTo(229.5, 8);
    await moveToHeader();
    await expect
      .poll(
        async () => {
          const pixels = await captureViewPixels();
          return (
            pixels.length === 3 &&
            pixels.every(({ blue }, index) => blue < beforeRange[index].blue)
          );
        },
        {
          message:
            'Expected the range slider to update the overlay immediately in all three views',
        }
      )
      .toBe(true);
    await saveScreenshot('overlay-display-controls.png');
  });

  test('edits overlay opacity in 3D Only and applies it when returning to slices', async ({
    page,
    volview,
    utils,
    layerDisplay,
  }) => {
    const {
      moveToHeader,
      windowingLabels,
      expectAppliedRange,
      expectDisplaySettings,
      expectRenderedPixels,
      openEditedDisplayFixture,
    } = createDisplayHelpers({ page, volview, utils, layerDisplay });
    const volumeValues = () =>
      page
        .locator('.mapping-range-editor input')
        .evaluateAll((inputs) =>
          inputs.map((input) => (input as HTMLInputElement).value)
        );
    const { baseWindowing, appliedPixels } = await openEditedDisplayFixture();
    await utils.selectLayout('3D Only', 0, true);
    for (const name of [
      'colormap',
      'range-min',
      'range-max',
      'transparent-background',
      'opacity-slider',
    ]) {
      await expect(page.locator(`[data-testid="layer-${name}"]`)).toBeVisible();
      await expect(
        page.locator(`[data-testid="layer-${name}"] input`)
      ).toBeEnabled();
    }
    for (const handle of await page
      .locator('[data-testid="layer-range-slider"] [role="slider"]')
      .all())
      await expect(handle).toHaveAttribute('tabindex', '0');
    const volumeSettings = await volumeValues();
    expect(volumeSettings).toHaveLength(2);
    const opacity = page.locator(
      '[data-testid="layer-opacity-slider"] [role="slider"]'
    );
    await opacity.focus();
    await page.keyboard.press('Home');
    await expect(opacity).toHaveAttribute('aria-valuenow', '0');
    expect(await volumeValues()).toEqual(volumeSettings);

    await utils.selectLayout('Axial Only', 1, false);
    await expectAppliedRange('-2.75', '100.25', '100.3');
    await expect(opacity).toHaveAttribute('aria-valuenow', '0');
    await moveToHeader();
    await expect
      .poll(
        async () => {
          const pixels = await utils.capture2DViewPixels(
            40,
            'base-without-overlay.png'
          );
          if (pixels.length !== 1) return false;
          let colored = 0;
          let brightGrayscale = 0;
          const { data } = pixels[0];
          for (let i = 0; i < data.length; i += 4) {
            const maximum = Math.max(data[i], data[i + 1], data[i + 2]);
            const minimum = Math.min(data[i], data[i + 1], data[i + 2]);
            if (maximum - minimum > 40) colored++;
            if (maximum - minimum < 5 && minimum > 32) brightGrayscale++;
          }
          return colored < 100 && brightGrayscale > 1000;
        },
        {
          message:
            'Expected the replacement axial view to show the base without colored overlay pixels',
        }
      )
      .toBe(true);
    await utils.selectLayout('3D Only', 0, true);
    await opacity.focus();
    await holdKey(page, 'PageUp', 5);
    await expectDisplaySettings('-2.75', '100.25', '100.3');
    expect(await volumeValues()).toEqual(volumeSettings);
    await utils.selectLayout('Four Up', 3, true);
    await expectDisplaySettings('-2.75', '100.25', '100.3');
    expect(await windowingLabels()).toEqual(baseWindowing);
    await expectRenderedPixels(appliedPixels);
  });

  test('restores global appearance after converting every 2D view', async ({
    page,
    volview,
    utils,
    layerDisplay,
  }) => {
    const {
      windowingLabels,
      expectDisplaySettings,
      expectRenderedPixels,
      openEditedDisplayFixture,
      convertSlicesToVolumes,
    } = createDisplayHelpers({ page, volview, utils, layerDisplay });
    const { baseWindowing, appliedPixels } = await openEditedDisplayFixture();
    await convertSlicesToVolumes();
    await utils.selectLayout('Four Up', 3, true);
    await expectDisplaySettings('-2.75', '100.25', '100.3');
    expect(await windowingLabels()).toEqual(baseWindowing);
    await expectRenderedPixels(appliedPixels);
  });

  test('restores global appearance from a session saved after removing the last 2D view', async ({
    page,
    volview,
    utils,
    layerDisplay,
  }) => {
    const {
      windowingLabels,
      expectDisplaySettings,
      expectRenderedPixels,
      openEditedDisplayFixture,
      convertSlicesToVolumes,
    } = createDisplayHelpers({ page, volview, utils, layerDisplay });
    const { baseWindowing, appliedPixels } =
      await openEditedDisplayFixture(true);
    await convertSlicesToVolumes();
    const saved = await volview.saveSession();
    await utils.openVolViewPage(saved);
    await volview.waitForViewCounts(0, true);
    await layerDisplay.openLayerDisplayControls();
    await expect(
      page.locator('[data-testid="layer-range-min"] input')
    ).toBeEnabled();
    await utils.selectLayout('Axial Only', 1, false);
    await expectDisplaySettings('-2.75', '100.25', '100.3');
    expect(await windowingLabels()).toEqual(baseWindowing);
    await expectRenderedPixels(appliedPixels);
  });

  test('preserves transparent background and rendered colors when reopening a session', async ({
    page,
    volview,
    utils,
    layerDisplay,
  }) => {
    const {
      option,
      moveToHeader,
      saveScreenshot,
      captureViewPixels,
      expectDisplaySettings,
      expectRenderedPixels,
      openDisplayFixture,
    } = createDisplayHelpers({ page, volview, utils, layerDisplay });
    await openDisplayFixture({ mappingRange: [0, 229.5] });
    await expectDisplaySettings('0', '229.5');
    const beforeTransparent = await captureViewPixels();
    const restoredTransparent = page.locator(
      '[data-testid="layer-transparent-background"] input'
    );
    await restoredTransparent.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await restoredTransparent.click();
    await expect(restoredTransparent).toBeChecked();
    const tooltipId =
      await restoredTransparent.getAttribute('aria-describedby');
    expect(tooltipId).toBeTruthy();
    await restoredTransparent.evaluate((input) =>
      (input as HTMLInputElement).blur()
    );
    await moveToHeader();
    await expect(
      page.locator(`[id="${tooltipId}"] .v-overlay__content`)
    ).toBeHidden();
    let transparentPixels = await captureViewPixels();
    await expect
      .poll(
        async () => {
          transparentPixels = await captureViewPixels();
          return (
            transparentPixels.length === 3 &&
            transparentPixels.every(
              ({ checksum }, index) =>
                checksum !== beforeTransparent[index].checksum
            )
          );
        },
        {
          message:
            'Expected transparent background to update every view before saving',
        }
      )
      .toBe(true);
    const transparentSession = await volview.saveSession();
    await utils.openVolViewPage(transparentSession);
    await layerDisplay.openLayerDisplayControls();
    await expect(
      page.locator('[data-testid="layer-transparent-background"] input')
    ).toBeChecked();
    await expectRenderedPixels(transparentPixels);

    const select = page.locator('[data-testid="layer-colormap"]');
    await select.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await select.click();
    await expect(option('Cool to Warm')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await page.keyboard.press('Escape');
    await saveScreenshot('overlay-transparent-restored.png');
  });

  test('offers the curated palette inventory and renders Spring and Winter in every view', async ({
    page,
    volview,
    utils,
    layerDisplay,
  }) => {
    const {
      option,
      moveToHeader,
      saveScreenshot,
      expectPaletteOptions,
      captureViewPixels,
      openDisplayFixture,
    } = createDisplayHelpers({ page, volview, utils, layerDisplay });
    await openDisplayFixture({
      mappingRange: [0, 229.5],
      transparentBackground: true,
    });
    const select = page.locator('[data-testid="layer-colormap"]');
    await select.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await select.click();
    await expectPaletteOptions();
    await expect(option('Cool to Warm')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    for (const title of ['DICOM Spring', 'DICOM Winter']) {
      await page.keyboard.press('Escape');
      await moveToHeader();
      const beforePalette = await captureViewPixels();
      await select.click();
      const item = option(title);
      await item.evaluate((element) =>
        element.scrollIntoView({ block: 'center', behavior: 'instant' })
      );
      await expect(item).toBeVisible();
      await expect(item).toBeEnabled();
      await expect(
        item.locator('[data-testid="layer-palette-option-swatch"]')
      ).toBeVisible();
      await item.click();
      await expect(select).toContainText(title);
      await moveToHeader();
      await expect
        .poll(
          async () => {
            const pixels = await captureViewPixels();
            return (
              pixels.length === 3 &&
              pixels.every(
                ({ checksum }, index) =>
                  checksum !== beforePalette[index].checksum
              )
            );
          },
          {
            message: `Expected ${title} to change colors in all three 2D views`,
          }
        )
        .toBe(true);
      await select.click();
      await expect(option(title)).toHaveAttribute('aria-selected', 'true');
    }
    await saveScreenshot('overlay-short-palette-menu.png');
    await page.keyboard.press('Escape');
    expect(await volview.getNotificationsCount()).toEqual(0);
  });
});
