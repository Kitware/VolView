import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  containsText,
  exactText,
  setValueVueInput,
} from '../pageobjects/volview.page';
import {
  layeredImageManifest,
  type LayerDisplayUtils,
} from './layerDisplayTestUtils';
import type { Utils } from './utils';

const createPaletteHelpers = ({
  page,
  utils,
  layerDisplay,
}: {
  page: Page;
  utils: Utils;
  layerDisplay: LayerDisplayUtils;
}) => {
  const control = (name: string) => page.locator(`[data-testid="${name}"]`);
  const handle = (name: string) => control(`layer-range-${name}-handle`);
  const input = (name: string) =>
    control(`layer-range-${name}`).locator('input');
  const bar = () => control('palette-window-bar');
  const gradient = () =>
    bar()
      .locator('.color-map-swatch')
      .first()
      .evaluate((element) => getComputedStyle(element).backgroundImage);
  const moveToHeader = () => utils.moveToElement(page.locator('header'));

  const range = async () =>
    Promise.all(
      ['min', 'max'].map(async (name) =>
        Number(await handle(name).getAttribute('aria-valuenow'))
      )
    );

  async function openPaletteWindow() {
    const base = utils.writeMetaImage('palette-window-base.mha');
    const overlay = utils.writeMetaImage('palette-window-overlay.mha', {
      step: 29,
    });
    const manifest = 'palette-window.json';
    await utils.writeManifestToFile(
      {
        ...layeredImageManifest(base, overlay),
        layerDisplay: {
          'base::overlay': {
            preset: '2hot',
            mappingRange: [50, 200],
            opacity: 1,
            transparentBackground: false,
          },
        },
      },
      manifest
    );
    await utils.openVolViewPage(manifest);
    const card = page
      .locator('.image-list-card', { hasText: containsText(base) })
      .first();
    await card.locator('[data-testid="dataset-menu-button"]').click();
    const showInAllViews = page
      .locator('.v-list-item', { hasText: containsText('Show in all views') })
      .first();
    await showInAllViews.click();
    await page.keyboard.press('Escape');
    await layerDisplay.openLayerDisplayControls();
    await expect(bar()).toBeVisible();
    await bar().evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await expect(input('min')).toHaveValue('50');
    await expect(input('max')).toHaveValue('200');
  }

  // The button stays down until `release`, as the old W3C action left it.
  async function drag(name: string, fraction: number) {
    const geometry = await page.evaluate(
      ({ selector, targetFraction }) => {
        const track = document
          .querySelector('[data-testid="palette-window-bar"]')!
          .getBoundingClientRect();
        const thumb = document.querySelector(selector)!.getBoundingClientRect();
        return {
          startX: Math.round(thumb.x + thumb.width / 2),
          startY: Math.round(thumb.y + thumb.height / 2),
          endX: Math.round(track.x + track.width * targetFraction),
        };
      },
      {
        selector: `[data-testid="layer-range-${name}-handle"]`,
        targetFraction: fraction,
      }
    );
    await page.mouse.move(geometry.startX, geometry.startY);
    await page.mouse.down();
    await page.mouse.move(geometry.endX, geometry.startY);
  }

  const release = () => page.mouse.up();

  async function dragBy(name: string, pixels: number) {
    const thumb = await handle(name).boundingBox();
    const barBox = await bar().boundingBox();
    if (!thumb || !barBox) throw new Error('Expected the range on screen');
    const x = Math.round(thumb.x + thumb.width / 2);
    const y = Math.round(thumb.y + thumb.height / 2);
    const width = barBox.width;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + pixels, y);
    await page.mouse.up();
    return (pixels / width) * 255;
  }

  const controlRects = () =>
    page.evaluate(() =>
      [
        '[data-testid="palette-window-bar"]',
        '[data-testid="layer-range-min"] input',
        '[data-testid="layer-range-max"] input',
      ].map((selector) => {
        const { x, y, width, height } = document
          .querySelector(selector)!
          .getBoundingClientRect();
        return { x, y, width, height };
      })
    );

  async function expectGripsAligned() {
    const { barCenter, gripCenters } = await page.evaluate(() => {
      const barRect = document
        .querySelector('[data-testid="palette-window-bar"]')!
        .getBoundingClientRect();
      return {
        barCenter: barRect.y + barRect.height / 2,
        gripCenters: Array.from(
          document.querySelectorAll(
            '[data-testid="palette-window-bar"] .handle-grip'
          )
        ).map((grip) => {
          const rect = grip.getBoundingClientRect();
          return rect.y + rect.height / 2;
        }),
      };
    });
    expect(gripCenters).toHaveLength(3);
    for (const center of gripCenters) expect(center).toBeCloseTo(barCenter, 8);
  }

  async function expectInputsSynced() {
    const [min, max] = await range();
    await expect(input('min')).toHaveAttribute('title', String(min));
    await expect(input('max')).toHaveAttribute('title', String(max));
    expect(min).toBeLessThan(max);
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(255);
  }

  async function press(name: string, key: string) {
    await page.evaluate((selector) => {
      document.querySelector<HTMLElement>(selector)!.focus();
    }, `[data-testid="layer-range-${name}-handle"]`);
    await expect(handle(name)).toBeFocused();
    await page.keyboard.press(key);
  }

  async function expectRange(min: number, max: number) {
    const actual = await range();
    expect(actual[0]).toBeCloseTo(min, 8);
    expect(actual[1]).toBeCloseTo(max, 8);
    await expectInputsSynced();
  }

  return {
    control,
    handle,
    input,
    gradient,
    moveToHeader,
    range,
    openPaletteWindow,
    drag,
    release,
    dragBy,
    controlRects,
    expectGripsAligned,
    expectInputsSynced,
    press,
    expectRange,
  };
};

test.describe('Palette window interaction', () => {
  test.beforeEach(({ page, utils, layerDisplay }) =>
    createPaletteHelpers({ page, utils, layerDisplay }).openPaletteWindow()
  );

  test('restores the original colors after collapsing and reopening the range', async ({
    page,
    utils,
    layerDisplay,
  }) => {
    const {
      control,
      gradient,
      moveToHeader,
      range,
      drag,
      release,
      expectRange,
    } = createPaletteHelpers({ page, utils, layerDisplay });
    const capture = () =>
      utils.captureViewPixels(
        '[data-testid~="vtk-two-view"]',
        40,
        'palette-window-reopened.png'
      );

    const selectPalette = async (name: string) => {
      await control('layer-colormap').click();
      const option = page.locator('[role="option"]', {
        hasText: exactText(name),
      });
      await option.evaluate((element) =>
        element.scrollIntoView({ block: 'center', behavior: 'instant' })
      );
      await option.click();
      await moveToHeader();
    };

    const fullRange = async () => {
      await control('layer-contrast').click();
      await control('layer-contrast-FullRange').click();
      await expectRange(0, 255);
      await moveToHeader();
    };

    await selectPalette('Grayscale');
    await fullRange();
    await expect
      .poll(async () => {
        const views = await utils.capture2DViewScreenshotMetrics(
          'palette-window-grayscale.png'
        );
        return (
          views.length === 3 &&
          views.every(({ colored, checksum }) => colored === 0 && checksum > 0)
        );
      })
      .toBe(true);
    await selectPalette('DICOM Hot Iron');
    await expect
      .poll(async () => {
        const views = await utils.capture2DViewScreenshotMetrics(
          'palette-window-hot-iron.png'
        );
        return (
          views.length === 3 && views.every(({ colored }) => colored > 1000)
        );
      })
      .toBe(true);
    const before = await capture();
    const originalGradient = await gradient();

    await drag('min', 1.1);
    await release();
    const [min, max] = await range();
    expect(min).toBeLessThan(max);
    expect(max - min).toBeLessThan(1e-10);
    await moveToHeader();
    await expect
      .poll(async () => {
        const collapsed = await capture();
        return (
          collapsed.length === 3 &&
          collapsed.every(({ data }, index) => !data.equals(before[index].data))
        );
      })
      .toBe(true);

    await fullRange();
    expect(await gradient()).toBe(originalGradient);
    await expect
      .poll(
        async () => {
          const reopened = await capture();
          return (
            reopened.length === 3 &&
            reopened.every(({ data }, index) => data.equals(before[index].data))
          );
        },
        {
          message: 'Expected Full Range to restore the original overlay pixels',
        }
      )
      .toBe(true);
  });

  test('updates the palette, numbers, and all views while dragging either endpoint', async ({
    page,
    utils,
    layerDisplay,
  }) => {
    const {
      gradient,
      range,
      drag,
      release,
      controlRects,
      expectGripsAligned,
      expectInputsSynced,
    } = createPaletteHelpers({ page, utils, layerDisplay });
    const before = await utils.capture2DViewScreenshotMetrics(
      'palette-window-before.png'
    );
    expect(before).toHaveLength(3);
    const initialGradient = await gradient();
    await drag('min', 0.4);
    await expect.poll(async () => (await range())[0]).toBeGreaterThan(90);
    await expectInputsSynced();
    expect((await range())[1]).toBe(200);
    expect(await gradient()).not.toBe(initialGradient);
    await expect
      .poll(
        async () => {
          const after = await utils.capture2DViewScreenshotMetrics(
            'palette-window-drag.png'
          );
          return (
            after.length === 3 &&
            after.every(
              (view, index) => view.checksum !== before[index].checksum
            )
          );
        },
        {
          message:
            'Expected the dragged range to update every 2D view before pointer release',
        }
      )
      .toBe(true);
    await release();

    const min = (await range())[0];
    await drag('max', 0.6);
    await expect.poll(async () => (await range())[1]).toBeLessThan(170);
    await expectInputsSynced();
    expect((await range())[0]).toBe(min);
    await release();

    await drag('min', 1);
    await expectInputsSynced();
    const collapsedAtMax = await range();
    expect(collapsedAtMax[0]).toBeCloseTo(collapsedAtMax[1], 8);
    await release();
    await drag('min', 0.2);
    await expectInputsSynced();
    const reopenedMinimum = await range();
    expect(reopenedMinimum[0]).toBeLessThan(collapsedAtMax[0]);
    expect(reopenedMinimum[1]).toBe(collapsedAtMax[1]);
    await release();

    const expandedRects = await controlRects();
    await expectGripsAligned();
    await drag('max', 0);
    await expectInputsSynced();
    expect(await controlRects()).toEqual(expandedRects);
    await expectGripsAligned();
    const collapsedAtMin = await range();
    expect(collapsedAtMin[1]).toBeCloseTo(collapsedAtMin[0], 8);
    await release();
    expect(await controlRects()).toEqual(expandedRects);
    await expectGripsAligned();
    await drag('max', 0.8);
    await expectInputsSynced();
    const reopenedMaximum = await range();
    expect(reopenedMaximum[1]).toBeGreaterThan(collapsedAtMin[1]);
    expect(reopenedMaximum[0]).toBe(collapsedAtMin[0]);
    expect(await controlRects()).toEqual(expandedRects);
    await expectGripsAligned();
    await release();
  });

  test('moves the whole window to either boundary without changing its width', async ({
    page,
    utils,
    layerDisplay,
  }) => {
    const { drag, release, press, expectRange } = createPaletteHelpers({
      page,
      utils,
      layerDisplay,
    });
    await drag('center', 0);
    await expectRange(0, 150);
    await release();
    await drag('center', 1);
    await expectRange(105, 255);
    await release();
    await press('center', 'ArrowRight');
    await expectRange(105, 255);
    await drag('center', 0);
    await expectRange(0, 150);
    await release();
    await press('center', 'ArrowLeft');
    await expectRange(0, 150);
    await press('center', 'ArrowRight');
    await expectRange(2.55, 152.55);
  });

  test('matches native hover feedback, shows keyboard halos and smaller directional circles for values outside the image', async ({
    page,
    utils,
    layerDisplay,
  }) => {
    const { control, handle, input, expectGripsAligned } = createPaletteHelpers(
      { page, utils, layerDisplay }
    );
    const normalSize = await handle('min')
      .locator('.handle-grip')
      .boundingBox();
    if (!normalSize) throw new Error('Expected the grip on screen');
    const supportsHover = await page.evaluate(
      () => matchMedia('(hover: hover)').matches
    );
    const opacitySlider = control('layer-opacity-slider').locator(
      '[role="slider"]'
    );
    await utils.moveToElement(opacitySlider);
    const nativeHalo = await opacitySlider
      .locator('.v-slider-thumb__surface')
      .evaluate((element) => ({
        opacity: Number(getComputedStyle(element, '::before').opacity),
        hoverOpacity: Number(
          getComputedStyle(element).getPropertyValue('--v-hover-opacity')
        ),
      }));
    if (
      !nativeHalo ||
      typeof nativeHalo !== 'object' ||
      !('opacity' in nativeHalo) ||
      !('hoverOpacity' in nativeHalo)
    )
      throw new Error('Expected native slider halo styles');
    const expectedHoverOpacity = supportsHover
      ? Number(nativeHalo.hoverOpacity)
      : 0;
    for (const name of ['min', 'max', 'center']) {
      await utils.moveToElement(handle(name));
      await expect
        .poll(() =>
          handle(name)
            .locator('.handle-grip')
            .evaluate(
              (element, opacity) =>
                Math.abs(
                  Number(getComputedStyle(element, '::before').opacity) -
                    Number(opacity)
                ) < 0.001,
              expectedHoverOpacity
            )
        )
        .toBe(true);
      expect(
        await handle(name).evaluate((element) => element.matches(':hover'))
      ).toBe(true);
    }
    if (!supportsHover) expect(Number(nativeHalo.opacity)).toBe(0);
    for (const name of ['min', 'max', 'center']) {
      await handle(name).focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await expect(handle(name)).toBeFocused();
      await expect
        .poll(() =>
          handle(name)
            .locator('.handle-grip')
            .evaluate(
              (element) =>
                Number(getComputedStyle(element, '::before').opacity) > 0
            )
        )
        .toBe(true);
    }
    await setValueVueInput(input('min'), '-100');
    await setValueVueInput(input('max'), '355');
    await page.keyboard.press('Enter');
    for (const [name, direction] of [
      ['min', 'left'],
      ['max', 'right'],
    ]) {
      const grip = handle(name).locator('.handle-grip');
      await expect(grip).toHaveAttribute('data-direction', direction);
      const size = await grip.boundingBox();
      if (!size) throw new Error('Expected the grip on screen');
      expect(size.width).toBeLessThan(normalSize.width);
      expect(size.width).toBe(size.height);
    }
    await expectGripsAligned();
    await setValueVueInput(input('min'), '-400');
    await setValueVueInput(input('max'), '-200');
    await page.keyboard.press('Enter');
    await expect(handle('center').locator('.handle-grip')).toHaveAttribute(
      'data-direction',
      'left'
    );
    const outsideCenter = await handle('center')
      .locator('.handle-grip')
      .boundingBox();
    if (!outsideCenter) throw new Error('Expected the grip on screen');
    expect(outsideCenter.width).toBeLessThan(normalSize.width);
    expect(outsideCenter.width).toBe(outsideCenter.height);
    await expectGripsAligned();
  });

  test('moves out-of-range endpoints continuously from their actual values', async ({
    page,
    utils,
    layerDisplay,
  }) => {
    const { input, range, dragBy, controlRects, expectGripsAligned } =
      createPaletteHelpers({ page, utils, layerDisplay });
    await setValueVueInput(input('min'), '-100');
    await setValueVueInput(input('max'), '100');
    await page.keyboard.press('Enter');
    const fixedAxis = await controlRects();
    const minDelta = await dragBy('min', 2);
    const left = await range();
    expect(left[0]).toBeCloseTo(-100 + minDelta, 8);
    expect(left[0]).toBeLessThan(0);
    expect(left[1]).toBe(100);
    expect(await controlRects()).toEqual(fixedAxis);
    await expectGripsAligned();

    await setValueVueInput(input('max'), '355');
    await setValueVueInput(input('min'), '155');
    await page.keyboard.press('Enter');
    const maxDelta = await dragBy('max', -2);
    const right = await range();
    expect(right[0]).toBe(155);
    expect(right[1]).toBeCloseTo(355 + maxDelta, 8);
    expect(right[1]).toBeGreaterThan(255);
    expect(await controlRects()).toEqual(fixedAxis);
    await expectGripsAligned();
  });

  test('moves a wider-than-image window and an offscreen center without changing width', async ({
    page,
    utils,
    layerDisplay,
  }) => {
    const { handle, input, range, dragBy, expectGripsAligned } =
      createPaletteHelpers({ page, utils, layerDisplay });
    await setValueVueInput(input('min'), '-100');
    await setValueVueInput(input('max'), '355');
    await page.keyboard.press('Enter');
    await expect(handle('center')).toBeEnabled();
    const wideDelta = await dragBy('center', 2);
    const wide = await range();
    expect(wide[0]).toBeCloseTo(-100 + wideDelta, 8);
    expect(wide[1]).toBeCloseTo(355 + wideDelta, 8);
    expect(wide[1] - wide[0]).toBeCloseTo(455, 8);

    await setValueVueInput(input('min'), '-400');
    await setValueVueInput(input('max'), '-200');
    await page.keyboard.press('Enter');
    await expect(handle('center')).toBeEnabled();
    const outsideDelta = await dragBy('center', 2);
    const outside = await range();
    expect(outside[0]).toBeCloseTo(-400 + outsideDelta, 8);
    expect(outside[1]).toBeCloseTo(-200 + outsideDelta, 8);
    expect(outside[1] - outside[0]).toBeCloseTo(200, 8);
    await expectGripsAligned();
  });

  test('recovers an offset full-width window and keeps its center interactive at the bounds', async ({
    page,
    utils,
    layerDisplay,
  }) => {
    const { handle, input, drag, release, expectRange } = createPaletteHelpers({
      page,
      utils,
      layerDisplay,
    });
    await setValueVueInput(input('min'), '-10');
    await page.keyboard.press('Enter');
    await setValueVueInput(input('max'), '245');
    await page.keyboard.press('Enter');
    await expect(input('min')).toHaveAttribute('title', '-10');
    await expect(input('max')).toHaveAttribute('title', '245');
    await expect(handle('center')).toBeEnabled();
    await drag('center', 1);
    await expectRange(0, 255);
    await release();
    await expect(handle('center')).toBeEnabled();
    await drag('center', 0);
    await expectRange(0, 255);
    await release();
    await drag('center', 1);
    await expectRange(0, 255);
    await release();
    await expect(handle('center')).toBeEnabled();
  });

  test('tabs through handles, supports arrow steps, and preserves precise manual input', async ({
    page,
    utils,
    layerDisplay,
  }) => {
    const {
      control,
      handle,
      input,
      range,
      expectInputsSynced,
      press,
      expectRange,
    } = createPaletteHelpers({ page, utils, layerDisplay });
    await control('layer-colormap').locator('input').focus();
    await page.keyboard.press('Tab');
    await expect(handle('min')).toBeFocused();
    await expectRange(50, 200);
    await page.keyboard.press('ArrowUp');
    await expectRange(52.55, 200);
    await page.keyboard.press('ArrowDown');
    await expectRange(50, 200);

    await page.keyboard.press('Tab');
    await expect(handle('max')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expectRange(50, 197.45);
    await page.keyboard.press('ArrowRight');
    await expectRange(50, 200);

    await page.keyboard.press('Tab');
    await expect(handle('center')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expectRange(52.55, 202.55);
    await page.keyboard.press('ArrowLeft');
    await expectRange(50, 200);
    for (const key of ['PageUp', 'PageDown', 'Home', 'End']) {
      await page.keyboard.press(key);
      await expectRange(50, 200);
    }

    await page.keyboard.press('Tab');
    await expect(input('min')).toBeFocused();
    for (const name of ['center', 'max', 'min']) {
      await page.keyboard.press('Shift+Tab');
      await expect(handle(name)).toBeFocused();
    }
    await expectRange(50, 200);

    await setValueVueInput(input('min'), '0');
    await setValueVueInput(input('max'), '1');
    await page.keyboard.press('Enter');
    await press('min', 'ArrowRight');
    await expectInputsSynced();
    const minimumBound = await range();
    expect(minimumBound[0]).toBeGreaterThan(0);
    expect(minimumBound[1]).toBe(1);
    await press('min', 'ArrowLeft');
    await press('max', 'ArrowLeft');
    await expectInputsSynced();
    const maximumBound = await range();
    expect(maximumBound[0]).toBe(0);
    expect(maximumBound[1]).toBe(Number.MIN_VALUE);

    await setValueVueInput(input('min'), '-2.123456789');
    await page.keyboard.press('Enter');
    await setValueVueInput(input('max'), '100.123456789');
    await page.keyboard.press('Enter');
    await page
      .locator('h4', { hasText: containsText('palette-window-overlay.mha') })
      .first()
      .click();
    await expect(input('min')).toHaveAttribute('title', '-2.123456789');
    await expect(input('max')).toHaveAttribute('title', '100.123456789');
    await setValueVueInput(input('max'), '-3');
    await page.keyboard.press('Enter');
    await expect(control('layer-range-status')).toHaveText(
      'Min must be less than Max.'
    );
    await expect(input('min')).toHaveAttribute('title', '-2.123456789');
    await expect(input('max')).toHaveAttribute('title', '100.123456789');
  });
});
