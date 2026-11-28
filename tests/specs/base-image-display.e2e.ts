import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  containsText,
  exactText,
  setValueVueInput,
  waitForTransitions,
  type VolViewPage,
} from '../pageobjects/volview.page';
import type { Utils } from './utils';

const createBaseHelpers = ({
  page,
  volview,
  utils,
}: {
  page: Page;
  volview: VolViewPage;
  utils: Utils;
}) => {
  const field = (endpoint: 'min' | 'max') =>
    page.locator(`[data-testid="base-image-range-${endpoint}"] input`);
  const handle = (endpoint: 'min' | 'max' | 'center') =>
    page.locator(`[data-testid="base-image-range-${endpoint}-handle"]`);
  const moveToHeader = () => utils.moveToElement(page.locator('header'));
  const activeMenu = () => page.locator('.v-menu.v-overlay--active').first();
  const menuLabel = (label: string) =>
    activeMenu().locator('label', { hasText: exactText(label) });
  const box = async (locator: Locator) => {
    const rect = await locator.boundingBox();
    if (!rect) throw new Error('Expected the element on screen');
    return rect;
  };

  async function openBase(withOverlay = false) {
    const directory = utils.makeTempDir('base-display');
    const header = [
      'NRRD0005',
      'type: short',
      'dimension: 3',
      'sizes: 16 16 16',
      'space: left-posterior-superior',
      'space directions: (1,0,0) (0,1,0) (0,0,1)',
      'space origin: (0,0,0)',
      'encoding: ascii',
    ].join('\n');
    // Every orthogonal plane contains a ramp, including negative CT values.
    const voxels = Array.from({ length: 4096 }, (_, index) => {
      const x = index % 16;
      const y = Math.floor(index / 16) % 16;
      const z = Math.floor(index / 256);
      return -1000 + ((x + y + z) % 16) * 100;
    }).join(' ');
    writeFileSync(join(directory, 'base.nrrd'), `${header}\n\n${voxels}`);
    await utils.writeManifestToFile(
      {
        windowing: { width: 1500, level: -250 },
        io: { layerExtension: 'layer' },
      },
      'base-display-config.json'
    );
    const overlay = withOverlay
      ? utils.writeMetaImage('base.layer.mha')
      : undefined;
    await volview.open(
      `?urls=[tmp/base-display-config.json,tmp/base-display/base.nrrd${
        overlay ? `,tmp/${overlay}` : ''
      }]`
    );
    await volview.waitForViews();
    await utils.selectLayout('Four Up', 3, true);
    await volview.renderingModuleTab.click();
    await utils.waitForModuleTransitions();
    for (const title of ['Color Presets', 'Cinematic Rendering']) {
      const section = page
        .locator('.v-expansion-panel-title', { hasText: containsText(title) })
        .first();
      if ((await section.getAttribute('aria-expanded')) === 'true')
        await section.click();
    }
    await utils.waitForModuleTransitions();
    await expect(page.locator('.Vue-Toastification__toast')).toHaveCount(0);
    await field('min').evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await expect(field('min')).toBeEnabled();
  }

  async function expectRange(minimum: number, maximum: number) {
    await expect(field('min')).toHaveAttribute('title', String(minimum));
    await expect(field('max')).toHaveAttribute('title', String(maximum));
    const label = `W/L: ${(maximum - minimum).toFixed(2)} / ${(
      (maximum + minimum) /
      2
    ).toFixed(2)}`;
    for (const view of await volview.views2D.all())
      await expect(view).toContainText(label);
  }

  async function setRange(minimum: string, maximum: string) {
    for (const [endpoint, value] of [
      ['min', minimum],
      ['max', maximum],
    ] as const) {
      const input = field(endpoint);
      await input.evaluate((element) =>
        element.scrollIntoView({ block: 'center', behavior: 'instant' })
      );
      await expect(input).toBeVisible();
      await waitForTransitions(input);
      await setValueVueInput(input, value);
    }
    await page.keyboard.press('Enter');
  }

  const capture = () =>
    utils.capture2DViewScreenshotMetrics('base-display-capture.png');

  async function expectViewsChanged(
    before: Awaited<ReturnType<typeof capture>>
  ) {
    await moveToHeader();
    await expect
      .poll(
        async () => {
          const after = await capture();
          return (
            after.length === 3 &&
            after.every(
              ({ checksum }, index) => checksum !== before[index].checksum
            )
          );
        },
        {
          message: 'Expected the base window to change all three slice images',
        }
      )
      .toBe(true);
  }

  async function openWindowing() {
    await volview.selectTool('mdi-circle-half-full');
    await expect(
      page.locator('.v-menu.v-overlay--active .manual-inputs input').first()
    ).toBeVisible();
    await waitForTransitions(
      page.locator('.v-menu.v-overlay--active .manual-inputs').first()
    );
  }

  async function expectRangeMatchesWindowing() {
    const minimum = Number(await field('min').getAttribute('title'));
    const maximum = Number(await field('max').getAttribute('title'));
    await expectRange(minimum, maximum);
    return [minimum, maximum] as const;
  }

  async function obliqueColors() {
    const views = await utils.captureViewPixels(
      '.oblique-grid [data-testid="vtk-view"]',
      40,
      'base-oblique-capture.png'
    );
    return views.map(({ data }) => {
      let colored = 0;
      for (let i = 0; i < data.length; i += 4)
        if (
          Math.max(data[i], data[i + 1], data[i + 2]) -
            Math.min(data[i], data[i + 1], data[i + 2]) >
          40
        )
          colored++;
      return colored;
    });
  }

  return {
    field,
    handle,
    moveToHeader,
    activeMenu,
    menuLabel,
    box,
    openBase,
    expectRange,
    setRange,
    capture,
    expectViewsChanged,
    openWindowing,
    expectRangeMatchesWindowing,
    obliqueColors,
  };
};

test.describe('Base image display range', () => {
  test('edits a base without overlays and synchronizes presets, keyboard, drag and mouse windowing', async ({
    page,
    volview,
    utils,
  }) => {
    const {
      field,
      handle,
      moveToHeader,
      menuLabel,
      box,
      openBase,
      expectRange,
      setRange,
      capture,
      expectViewsChanged,
      openWindowing,
      expectRangeMatchesWindowing,
    } = createBaseHelpers({ page, volview, utils });
    await openBase();
    await expect(
      page.locator('[data-testid="base-image-properties"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="layer-colormap"]')
    ).not.toBeAttached();
    await expectRange(-1000, 500);
    await moveToHeader();
    const original = await capture();
    await setRange('-800', '200');
    await expectRange(-800, 200);
    await expectViewsChanged(original);
    await setRange('50', '200');
    await setValueVueInput(field('min'), '300.000');
    await setValueVueInput(field('max'), '400.000');
    await expectRange(300, 400);
    await expect(field('max')).toBeFocused();
    await expect(field('max')).toHaveValue('400.000');
    await openWindowing();
    const manual = page.locator('.v-overlay--active .manual-inputs input');
    await expect(manual.nth(0)).toHaveValue('100');
    await expect(manual.nth(1)).toHaveValue('350');
    await setValueVueInput(manual.nth(0), '600');
    await setValueVueInput(manual.nth(1), '-200');
    await page.keyboard.press('Enter');
    await expectRange(-500, 100);
    await expect(field('min')).toHaveValue('-500');
    await expect(field('max')).toHaveValue('100');
    await expect(
      page.locator('[data-testid="base-image-range-status"]')
    ).not.toBeAttached();
    await page.keyboard.press('Escape');
    await setValueVueInput(field('min'), '-');
    await openWindowing();
    await menuLabel('Air').click();
    await expectRange(-926, 74);
    await expect(field('min')).toHaveValue('-');
    await page.keyboard.press('Escape');
    await setValueVueInput(field('min'), '0.1');
    await field('max').click();
    expect(Number(await field('min').getAttribute('title'))).toBeCloseTo(
      0.1,
      12
    );
    await openWindowing();
    await menuLabel('Air').click();
    await expectRange(-926, 74);
    await expect(field('min')).toHaveValue('-926');
    await page.keyboard.press('Escape');
    await field('min').evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    const gradient = await page
      .locator('[data-testid="base-image-range-bar"] .color-map-swatch')
      .first()
      .getAttribute('style');
    if (!gradient) throw new Error('Expected a base grayscale gradient');
    expect(gradient).toContain('linear-gradient(');
    await setRange('-800', '200');
    await handle('max').focus();
    await page.keyboard.press('ArrowDown');
    await expectRange(-800, 185);
    await setRange('180', '185');
    await handle('min').focus();
    await expect(handle('min')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    for (const endpoint of ['min', 'max', 'center'] as const)
      await expect(handle(endpoint)).toBeEnabled();
    const narrow = await expectRangeMatchesWindowing();
    expect(narrow[0]).toBeGreaterThan(184);
    expect(narrow[0]).toBeLessThan(narrow[1]);
    expect(narrow[1]).toBe(185);
    await setRange('-995', '185');
    await handle('min').focus();
    await page.keyboard.press('ArrowLeft');
    await expectRange(-1000, 185);
    await setRange('-800', '-795');
    await handle('max').focus();
    await expect(handle('max')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    const narrowAtMin = await expectRangeMatchesWindowing();
    expect(narrowAtMin[0]).toBe(-800);
    expect(narrowAtMin[1]).toBeGreaterThan(-800);
    expect(narrowAtMin[1]).toBeLessThan(-799);
    await setRange('-800', '50');
    const center = await box(handle('center'));
    const x = Math.round(center.x + center.width / 2);
    const y = Math.round(center.y + center.height / 2);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 15, y);
    await page.mouse.up();
    const dragged = await expectRangeMatchesWindowing();
    expect(dragged[0]).toBeGreaterThan(-800);
    expect(dragged[1] - dragged[0]).toBeCloseTo(850, 8);
    await expect(
      page
        .locator('[data-testid="base-image-range-bar"] .color-map-swatch')
        .first()
    ).not.toHaveAttribute('style', gradient);

    await setRange('100', '200');
    await setValueVueInput(field('max'), '99');
    await page.keyboard.press('Enter');
    await expect(
      page.locator('[data-testid="base-image-range-status"]')
    ).toHaveText('Min must be less than Max.');
    await expectRange(100, 200);
    await setValueVueInput(field('max'), '200');
    await page.keyboard.press('Enter');
    await setRange('-800', '200');
    const canvas = await box(volview.views2D.first().locator('canvas'));
    const cx = Math.round(canvas.x + canvas.width / 2);
    const cy = Math.round(canvas.y + canvas.height / 2);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 30, cy + 20);
    await page.mouse.up();
    await expect
      .poll(async () => Number(await field('min').getAttribute('title')))
      .not.toBe(-800);
    const mouseRange = await expectRangeMatchesWindowing();
    expect(mouseRange).not.toEqual([-800, 200]);
  });

  test('colors the base slices independently of windowing and volume rendering', async ({
    page,
    volview,
    utils,
    layerDisplay,
  }) => {
    const {
      moveToHeader,
      menuLabel,
      openBase,
      expectRange,
      capture,
      expectViewsChanged,
    } = createBaseHelpers({ page, volview, utils });
    await openBase();
    await expect(
      page.locator('[data-testid="base-image-colormap"]')
    ).toContainText('Grayscale');
    await expect(
      page.locator('[data-testid="layer-colormap"]')
    ).not.toBeAttached();
    await moveToHeader();
    const before = await capture();
    const volumeValues = () =>
      page
        .locator('.mapping-range-editor input')
        .evaluateAll((inputs) =>
          inputs.map((input) => (input as HTMLInputElement).value)
        );
    const volumeSettings = await volumeValues();
    await layerDisplay.selectBasePalette('DICOM Hot Iron');
    await expectRange(-1000, 500);
    await expectViewsChanged(before);
    await expect
      .poll(async () =>
        (await capture()).every(({ colored }) => colored > 1000)
      )
      .toBe(true);
    expect(await volumeValues()).toEqual(volumeSettings);
    await page.locator('[data-testid="base-image-contrast"]').click();
    await waitForTransitions(
      page.locator('.v-menu.v-overlay--active .v-card').first()
    );
    await menuLabel('Air').click();
    await page.keyboard.press('Escape');
    await expectRange(-926, 74);
    await expect(
      page.locator('[data-testid="base-image-colormap"]')
    ).toContainText('DICOM Hot Iron');
  });

  test('uses local Contrast presets to recover an offscreen window without snapping a drag', async ({
    page,
    volview,
    utils,
  }) => {
    const {
      field,
      handle,
      menuLabel,
      box,
      openBase,
      expectRange,
      expectRangeMatchesWindowing,
    } = createBaseHelpers({ page, volview, utils });
    await openBase();
    const volume = await volview.getView3D();
    await volume!.click();
    const volumeBorder = () =>
      volume!.evaluate(
        (element) =>
          getComputedStyle(element.closest('.grid-item')!).borderColor
      );
    expect(await volumeBorder()).toBe('rgb(60, 179, 113)');
    const contrast = page.locator('[data-testid="base-image-contrast"]');
    await expect(contrast).toBeVisible();
    await expect(contrast.locator('.mdi-menu-down')).toBeAttached();
    const minimumRect = await box(field('min'));
    const maximumRect = await box(field('max'));
    const contrastRect = await box(contrast);
    expect(contrastRect.x).toBeGreaterThan(minimumRect.x);
    expect(contrastRect.x).toBeLessThan(maximumRect.x);
    const activeCard = page
      .locator('.v-menu.v-overlay--active .v-card')
      .first();
    await contrast.click();
    await waitForTransitions(activeCard);
    await expectRange(-1000, 500);
    await menuLabel('Lungs').click();
    await expectRange(-1350, 150);
    expect(await volumeBorder()).toBe('rgb(60, 179, 113)');
    await page.keyboard.press('Escape');
    await expect(handle('min').locator('.handle-grip')).toHaveAttribute(
      'data-direction',
      'left'
    );
    const thumb = await box(handle('min'));
    const x = Math.round(thumb.x + thumb.width / 2);
    const y = Math.round(thumb.y + thumb.height / 2);
    const trackWidth = (
      await box(page.locator('[data-testid="base-image-range-bar"]'))
    ).width;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 2, y);
    await page.mouse.up();
    const dragged = await expectRangeMatchesWindowing();
    expect(dragged[0]).toBeCloseTo(-1350 + (2 / trackWidth) * 1500, 8);
    expect(dragged[0]).toBeLessThan(-1000);
    expect(dragged[1]).toBeCloseTo(150, 8);

    await contrast.click();
    await waitForTransitions(activeCard);
    expect(await expectRangeMatchesWindowing()).toEqual(dragged);
    const manual = page.locator(
      '.v-menu.v-overlay--active .manual-inputs input'
    );
    await waitForTransitions(
      page.locator('.v-menu.v-overlay--active .manual-inputs').first()
    );
    await setValueVueInput(manual.nth(0), '100');
    await setValueVueInput(manual.nth(1), '-2000');
    await page.keyboard.press('Enter');
    await expectRange(-2050, -1950);
    await page.keyboard.press('Escape');
    await expect(handle('center')).toBeEnabled();
    await expect(handle('center').locator('.handle-grip')).toHaveAttribute(
      'data-direction',
      'left'
    );
    await contrast.click();
    await waitForTransitions(activeCard);
    await expectRange(-2050, -1950);
    await menuLabel('Full Range').click();
    await expectRange(-1000, 500);
    await page.keyboard.press('Escape');
    await expect(field('min')).toHaveValue('-1000');
    await expect(field('max')).toHaveValue('500');
    for (const draft of ['-', '']) {
      await setValueVueInput(field('min'), draft);
      await page.keyboard.press('Enter');
      await expect(
        page.locator('[data-testid="base-image-range-status"]')
      ).toBeVisible();
      await contrast.click();
      await waitForTransitions(activeCard);
      await menuLabel('Full Range').click();
      await page.keyboard.press('Escape');
      await expect(field('min')).toHaveValue('-1000');
      await expect(field('max')).toHaveValue('500');
      await expect(
        page.locator('[data-testid="base-image-range-status"]')
      ).not.toBeAttached();
    }
  });

  test('shares base palette, range, visibility and reset with oblique views', async ({
    page,
    volview,
    utils,
    layerDisplay,
  }) => {
    const {
      field,
      moveToHeader,
      menuLabel,
      openBase,
      expectRange,
      setRange,
      obliqueColors,
    } = createBaseHelpers({ page, volview, utils });
    const showOblique = async () => {
      await utils.showObliqueLayout();
      await waitForTransitions(page.locator('.oblique-grid'));
    };
    await openBase();
    await layerDisplay.selectBasePalette('DICOM Hot Iron');
    await setRange('-800', '200');
    await showOblique();
    await expect(field('min')).toBeEnabled();
    await expectRange(-800, 200);
    for (const view of await page
      .locator(
        '.oblique-grid > .d-flex:not(:nth-child(2)) [data-testid="vtk-view"]'
      )
      .all())
      await expect(view).toContainText('W/L: 1000.00 / -300.00');
    await moveToHeader();
    await expect
      .poll(async () => {
        const colors = await obliqueColors();
        return colors.length === 4 && colors.every((count) => count > 1000);
      })
      .toBe(true);
    const colored = await obliqueColors();

    const expectUncolored = async () => {
      await moveToHeader();
      await expect
        .poll(async () => {
          const colors = await obliqueColors();
          return (
            colors.length === 4 &&
            colors.every((count, i) => count < colored[i] / 3)
          );
        })
        .toBe(true);
    };

    const expectColored = async () => {
      await moveToHeader();
      await expect
        .poll(async () => {
          const colors = await obliqueColors();
          return (
            colors.length === 4 &&
            colors.every((count, i) => count > colored[i] / 2)
          );
        })
        .toBe(true);
    };

    await layerDisplay.selectBasePalette('Grayscale');
    await expectUncolored();
    await layerDisplay.selectBasePalette('DICOM Hot Iron');
    await expectColored();
    await setRange('-2000', '-1000');
    await expectRange(-2000, -1000);
    await expectUncolored();
    await page.locator('[data-testid="base-image-contrast"]').click();
    await waitForTransitions(
      page.locator('.v-menu.v-overlay--active .v-card').first()
    );
    await menuLabel('Full Range').click();
    await page.keyboard.press('Escape');
    await expectRange(-1000, 500);
    await expectColored();
    const visibility = page.locator('[data-testid="base-image-visibility"]');
    await visibility.click();
    await expectUncolored();
    await utils.selectLayout('Four Up', 3, true);
    await expect(visibility).toContainText('SHOW', { useInnerText: true });
    await expectRange(-1000, 500);
    await expect(
      page.locator('[data-testid="base-image-colormap"]')
    ).toContainText('DICOM Hot Iron');
    await showOblique();
    await expectUncolored();
    await visibility.click();
    await expectColored();
    await setRange('-800', '200');
    await page.locator('[data-testid="control-button-Reset Views"]').click();
    await expectRange(-1000, 500);
    await expect(
      page.locator('[data-testid="base-image-colormap"]')
    ).toContainText('Grayscale');
    await expect(visibility).toContainText('HIDE', { useInnerText: true });
    await expectUncolored();
  });

  test('preserves the base window through layouts and a saved session without changing overlay settings', async ({
    page,
    volview,
    utils,
    layerDisplay,
  }) => {
    const {
      field,
      handle,
      moveToHeader,
      box,
      openBase,
      expectRange,
      setRange,
      capture,
      expectViewsChanged,
    } = createBaseHelpers({ page, volview, utils });
    await openBase(true);
    const overlayMin = () =>
      page.locator('[data-testid="layer-range-min"] input');
    const overlayMax = () =>
      page.locator('[data-testid="layer-range-max"] input');
    await expect(overlayMin()).toBeEnabled();

    const overlaySettings = async () => ({
      min: await overlayMin().getAttribute('title'),
      max: await overlayMax().getAttribute('title'),
      palette: await page.locator('[data-testid="layer-colormap"]').innerText(),
      opacity: await page
        .locator('[data-testid="layer-opacity-slider"] input')
        .inputValue(),
      transparent: await page
        .locator('[data-testid="layer-transparent-background"] input')
        .isChecked(),
    });
    const borderRadius = (locator: Locator) =>
      locator.evaluate((element) => getComputedStyle(element).borderRadius);

    const initialOverlay = await overlaySettings();
    await layerDisplay.selectBasePalette('Viridis');
    await setRange('-800', '200');
    await expectRange(-800, 200);
    expect(await overlaySettings()).toEqual(initialOverlay);
    const visibility = () =>
      page.locator('[data-testid="base-image-visibility"]');
    await expect(visibility()).toContainText('HIDE', { useInnerText: true });
    expect((await box(visibility())).x).toBeLessThan(
      (await box(page.locator('[data-testid="base-image-colormap"]'))).x
    );
    expect(await borderRadius(visibility())).toBe(
      await borderRadius(page.locator('[data-testid="base-image-contrast"]'))
    );
    await moveToHeader();
    const shown = await capture();
    await visibility().click();
    await expect(visibility()).toContainText('SHOW', { useInnerText: true });
    await moveToHeader();
    await expect
      .poll(async () => {
        const hidden = await capture();
        return (
          hidden.length === 3 &&
          hidden.every(
            (view, i) =>
              view.colored > 1000 && view.checksum !== shown[i].checksum
          )
        );
      })
      .toBe(true);
    await expectRange(-800, 200);
    expect(await overlaySettings()).toEqual(initialOverlay);
    await visibility().click();
    await moveToHeader();
    await expect
      .poll(async () => {
        const restored = await capture();
        return (
          restored.length === 3 &&
          restored.every((view, i) => view.checksum === shown[i].checksum)
        );
      })
      .toBe(true);
    await visibility().click();
    await utils.selectLayout('3D Only', 0, true);
    await expect(field('min')).toBeVisible();
    await expect(visibility()).toBeDisabled();
    await expect(field('min')).toBeDisabled();
    await expect(field('max')).toBeDisabled();
    await expect(
      page.locator('[data-testid="base-image-contrast"]')
    ).toBeDisabled();
    await expect(
      page.locator('[data-testid="base-image-colormap"] input')
    ).toBeDisabled();
    for (const endpoint of ['min', 'max', 'center'] as const)
      await expect(handle(endpoint)).toHaveAttribute('tabindex', '-1');
    await utils.moveToElement(
      page.locator('[data-testid="base-image-properties"] .ms-4').first()
    );
    await expect(
      page.locator('.v-tooltip.v-overlay--active .v-overlay__content').first()
    ).toHaveText(
      'Open a slice or En face view showing this image to adjust window/level.'
    );
    await utils.selectLayout('Axial Only', 1, false);
    await expect(visibility()).toContainText('SHOW', { useInnerText: true });
    await expectRange(-800, 200);
    await expect(field('min')).toBeEnabled();
    const saved = await volview.saveSession();
    await utils.openVolViewPage(saved);
    await volview.renderingModuleTab.click();
    await utils.waitForModuleTransitions();
    await field('min').evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await expectRange(-800, 200);
    await utils.selectLayout('Four Up', 3, true);
    await expect(visibility()).toContainText('SHOW', { useInnerText: true });
    await expectRange(-800, 200);
    expect(await overlaySettings()).toEqual(initialOverlay);
    await expect(
      page.locator('[data-testid="base-image-colormap"]')
    ).toContainText('Viridis');
    await moveToHeader();
    const hidden = await capture();
    await visibility().click();
    await expect(visibility()).toContainText('HIDE', { useInnerText: true });
    await moveToHeader();
    await expectViewsChanged(hidden);
    expect(await overlaySettings()).toEqual(initialOverlay);
  });
});
