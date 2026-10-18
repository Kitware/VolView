import {
  layeredImageManifest,
  openLayerDisplayControls,
} from './layerDisplayTestUtils';
import { setValueVueInput } from '../pageobjects/volview.page';
import {
  capture2DViewScreenshotMetrics,
  openVolViewPage,
  writeManifestToFile,
  writeMetaImage,
} from './utils';

const control = (name: string) => $(`[data-testid="${name}"]`);
const handle = (name: string) => control(`layer-range-${name}-handle`);
const input = (name: string) => control(`layer-range-${name}`).$('input');
const bar = () => control('palette-window-bar');
const gradient = async () =>
  (await bar().$('.color-map-swatch').getCSSProperty('background-image')).value;
const range = async () =>
  Promise.all(
    ['min', 'max'].map(async (name) =>
      Number(await handle(name).getAttribute('aria-valuenow'))
    )
  );

async function openPaletteWindow() {
  const base = writeMetaImage('palette-window-base.mha');
  const overlay = writeMetaImage('palette-window-overlay.mha', { step: 29 });
  const manifest = 'palette-window.json';
  await writeManifestToFile(
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
  await openVolViewPage(manifest);
  const card = $(`.image-list-card*=${base}`);
  await card.$('[data-testid="dataset-menu-button"]').click();
  const showInAllViews = $('.v-list-item*=Show in all views');
  await showInAllViews.waitForClickable();
  await showInAllViews.click();
  await browser.keys('Escape');
  await openLayerDisplayControls();
  await bar().waitForDisplayed();
  await bar().scrollIntoView({ block: 'center', behavior: 'instant' });
  await expect(input('min')).toHaveValue('50');
  await expect(input('max')).toHaveValue('200');
}

async function drag(name: string, fraction: number) {
  const geometry = await browser.execute(
    (selector, targetFraction) => {
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
    `[data-testid="layer-range-${name}-handle"]`,
    fraction
  );
  await browser.performActions([
    {
      type: 'pointer',
      id: 'range-pointer',
      parameters: { pointerType: 'mouse' },
      actions: [
        {
          type: 'pointerMove',
          duration: 0,
          origin: 'viewport',
          x: geometry.startX,
          y: geometry.startY,
        },
        { type: 'pointerDown', button: 0 },
        {
          type: 'pointerMove',
          duration: 0,
          origin: 'viewport',
          x: geometry.endX,
          y: geometry.startY,
        },
      ],
    },
  ]);
}

async function dragBy(name: string, pixels: number) {
  const thumb = handle(name);
  const location = await thumb.getLocation();
  const size = await thumb.getSize();
  const x = Math.round(location.x + size.width / 2);
  const y = Math.round(location.y + size.height / 2);
  const width = (await bar().getSize()).width;
  await browser
    .action('pointer')
    .move({ x, y })
    .down()
    .move({ x: x + pixels, y })
    .up()
    .perform();
  return (pixels / width) * 255;
}

const controlRects = () =>
  browser.execute(() =>
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
  const { barCenter, gripCenters } = await browser.execute(() => {
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
  await browser.execute((selector) => {
    document.querySelector<HTMLElement>(selector)!.focus();
  }, `[data-testid="layer-range-${name}-handle"]`);
  await browser.keys(key);
}

async function expectRange(min: number, max: number) {
  const actual = await range();
  expect(actual[0]).toBeCloseTo(min, 8);
  expect(actual[1]).toBeCloseTo(max, 8);
  await expectInputsSynced();
}

describe('Palette window interaction', () => {
  beforeEach(openPaletteWindow);
  afterEach(async () => {
    await browser.releaseActions();
  });

  it('updates the palette, numbers, and all views while dragging either endpoint', async () => {
    const before = await capture2DViewScreenshotMetrics(
      'palette-window-before.png'
    );
    expect(before).toHaveLength(3);
    const initialGradient = await gradient();
    await drag('min', 0.4);
    await browser.waitUntil(async () => (await range())[0] > 90);
    await expectInputsSynced();
    expect((await range())[1]).toBe(200);
    expect(await gradient()).not.toBe(initialGradient);
    await browser.waitUntil(
      async () => {
        const after = await capture2DViewScreenshotMetrics(
          'palette-window-drag.png'
        );
        return (
          after.length === 3 &&
          after.every((view, index) => view.checksum !== before[index].checksum)
        );
      },
      {
        timeoutMsg:
          'Expected the dragged range to update every 2D view before pointer release',
      }
    );
    await browser.releaseActions();

    const min = (await range())[0];
    await drag('max', 0.6);
    await browser.waitUntil(async () => (await range())[1] < 170);
    await expectInputsSynced();
    expect((await range())[0]).toBe(min);
    await browser.releaseActions();

    await drag('min', 1);
    await expectInputsSynced();
    const collapsedAtMax = await range();
    expect(collapsedAtMax[0]).toBeCloseTo(collapsedAtMax[1], 8);
    await browser.releaseActions();
    await drag('min', 0.2);
    await expectInputsSynced();
    const reopenedMinimum = await range();
    expect(reopenedMinimum[0]).toBeLessThan(collapsedAtMax[0]);
    expect(reopenedMinimum[1]).toBe(collapsedAtMax[1]);
    await browser.releaseActions();

    const expandedRects = await controlRects();
    await expectGripsAligned();
    await drag('max', 0);
    await expectInputsSynced();
    expect(await controlRects()).toEqual(expandedRects);
    await expectGripsAligned();
    const collapsedAtMin = await range();
    expect(collapsedAtMin[1]).toBeCloseTo(collapsedAtMin[0], 8);
    await browser.releaseActions();
    expect(await controlRects()).toEqual(expandedRects);
    await expectGripsAligned();
    await drag('max', 0.8);
    await expectInputsSynced();
    const reopenedMaximum = await range();
    expect(reopenedMaximum[1]).toBeGreaterThan(collapsedAtMin[1]);
    expect(reopenedMaximum[0]).toBe(collapsedAtMin[0]);
    expect(await controlRects()).toEqual(expandedRects);
    await expectGripsAligned();
    await browser.releaseActions();
  });

  it('moves the whole window to either boundary without changing its width', async () => {
    await drag('center', 0);
    await expectRange(0, 150);
    await browser.releaseActions();
    await drag('center', 1);
    await expectRange(105, 255);
    await browser.releaseActions();
    await press('center', 'Home');
    await expectRange(0, 150);
    await press('center', 'ArrowRight');
    await expectRange(2.55, 152.55);
    await press('center', 'End');
    await expectRange(105, 255);
  });

  it('matches native hover feedback, shows keyboard halos and smaller directional circles for values outside the image', async () => {
    const normalSize = await handle('min').$('.handle-grip').getSize();
    const supportsHover = await browser.execute(
      () => matchMedia('(hover: hover)').matches
    );
    const opacitySlider = control('layer-opacity-slider').$('[role="slider"]');
    await opacitySlider.moveTo();
    const nativeHalo = await opacitySlider
      .$('.v-slider-thumb__surface')
      .execute((element) => ({
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
      await handle(name).moveTo();
      await browser.waitUntil(async () =>
        handle(name)
          .$('.handle-grip')
          .execute(
            (element, opacity) =>
              Math.abs(
                Number(getComputedStyle(element, '::before').opacity) -
                  Number(opacity)
              ) < 0.001,
            expectedHoverOpacity
          )
      );
      expect(
        await handle(name).execute((element) => element.matches(':hover'))
      ).toBe(true);
    }
    if (!supportsHover) expect(Number(nativeHalo.opacity)).toBe(0);
    for (const name of ['min', 'max', 'center']) {
      await handle(name).execute((element) => element.focus());
      await browser.keys('Tab');
      await browser.keys(['Shift', 'Tab']);
      await expect(handle(name)).toBeFocused();
      await browser.waitUntil(async () =>
        handle(name)
          .$('.handle-grip')
          .execute(
            (element) =>
              Number(getComputedStyle(element, '::before').opacity) > 0
          )
      );
    }
    await setValueVueInput(input('min'), '-100');
    await setValueVueInput(input('max'), '355');
    await browser.keys('Enter');
    for (const [name, direction] of [
      ['min', 'left'],
      ['max', 'right'],
    ]) {
      const grip = handle(name).$('.handle-grip');
      await expect(grip).toHaveAttribute('data-direction', direction);
      const size = await grip.getSize();
      expect(size.width).toBeLessThan(normalSize.width);
      expect(size.width).toBe(size.height);
    }
    await expectGripsAligned();
    await setValueVueInput(input('min'), '-400');
    await setValueVueInput(input('max'), '-200');
    await browser.keys('Enter');
    await expect(handle('center').$('.handle-grip')).toHaveAttribute(
      'data-direction',
      'left'
    );
    const outsideCenter = await handle('center').$('.handle-grip').getSize();
    expect(outsideCenter.width).toBeLessThan(normalSize.width);
    expect(outsideCenter.width).toBe(outsideCenter.height);
    await expectGripsAligned();
  });

  it('moves out-of-range endpoints continuously from their actual values', async () => {
    await setValueVueInput(input('min'), '-100');
    await setValueVueInput(input('max'), '100');
    await browser.keys('Enter');
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
    await browser.keys('Enter');
    const maxDelta = await dragBy('max', -2);
    const right = await range();
    expect(right[0]).toBe(155);
    expect(right[1]).toBeCloseTo(355 + maxDelta, 8);
    expect(right[1]).toBeGreaterThan(255);
    expect(await controlRects()).toEqual(fixedAxis);
    await expectGripsAligned();
  });

  it('moves a wider-than-image window and an offscreen center without changing width', async () => {
    await setValueVueInput(input('min'), '-100');
    await setValueVueInput(input('max'), '355');
    await browser.keys('Enter');
    await expect(handle('center')).toBeEnabled();
    const wideDelta = await dragBy('center', 2);
    const wide = await range();
    expect(wide[0]).toBeCloseTo(-100 + wideDelta, 8);
    expect(wide[1]).toBeCloseTo(355 + wideDelta, 8);
    expect(wide[1] - wide[0]).toBeCloseTo(455, 8);

    await setValueVueInput(input('min'), '-400');
    await setValueVueInput(input('max'), '-200');
    await browser.keys('Enter');
    await expect(handle('center')).toBeEnabled();
    const outsideDelta = await dragBy('center', 2);
    const outside = await range();
    expect(outside[0]).toBeCloseTo(-400 + outsideDelta, 8);
    expect(outside[1]).toBeCloseTo(-200 + outsideDelta, 8);
    expect(outside[1] - outside[0]).toBeCloseTo(200, 8);
    await expectGripsAligned();
  });

  it('recovers an offset full-width window and keeps its center interactive at the bounds', async () => {
    await setValueVueInput(input('min'), '-10');
    await browser.keys('Enter');
    await setValueVueInput(input('max'), '245');
    await browser.keys('Enter');
    await expect(input('min')).toHaveAttribute('title', '-10');
    await expect(input('max')).toHaveAttribute('title', '245');
    await expect(handle('center')).toBeEnabled();
    await press('center', 'Home');
    await expectRange(0, 255);
    await expect(handle('center')).toBeEnabled();
    await drag('center', 0);
    await expectRange(0, 255);
    await browser.releaseActions();
    await drag('center', 1);
    await expectRange(0, 255);
    await browser.releaseActions();
    await expect(handle('center')).toBeEnabled();
  });

  it('supports endpoint keyboard steps and preserves precise manual input', async () => {
    await press('min', 'Home');
    await expectRange(0, 200);
    await press('max', 'End');
    await expectRange(0, 255);
    await press('max', 'PageDown');
    await expectRange(0, 229.5);
    await press('min', 'ArrowRight');
    await expectRange(2.55, 229.5);
    await press('min', 'End');
    await expectInputsSynced();
    await press('max', 'Home');
    await expectInputsSynced();

    await setValueVueInput(input('min'), '-2.123456789');
    await browser.keys('Enter');
    await setValueVueInput(input('max'), '100.123456789');
    await browser.keys('Enter');
    await $('h4*=palette-window-overlay.mha').click();
    await expect(input('min')).toHaveAttribute('title', '-2.123456789');
    await expect(input('max')).toHaveAttribute('title', '100.123456789');
    await setValueVueInput(input('max'), '-3');
    await browser.keys('Enter');
    await expect(control('layer-range-status')).toHaveText(
      'Min must be less than Max.'
    );
    await expect(input('min')).toHaveAttribute('title', '-2.123456789');
    await expect(input('max')).toHaveAttribute('title', '100.123456789');
  });
});
