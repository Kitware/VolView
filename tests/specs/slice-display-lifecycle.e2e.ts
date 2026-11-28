import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  containsText,
  exactText,
  setValueVueInput,
  waitForTransitions,
  type VolViewPage,
} from '../pageobjects/volview.page';
import {
  layeredImageManifest,
  type LayerDisplayUtils,
} from './layerDisplayTestUtils';
import type { Utils } from './utils';

const baseName = 'slice-lifecycle-base.mha';
const overlayName = 'slice-lifecycle-overlay.mha';
const obliqueSlices =
  '.oblique-grid > .d-flex:not(:nth-child(2)) [data-testid="vtk-view"]';

const coloredPixelCount = (data: Buffer) =>
  data.filter(
    (red, i) =>
      i % 4 === 0 &&
      Math.max(red, data[i + 1], data[i + 2]) -
        Math.min(red, data[i + 1], data[i + 2]) >
        40
  ).length;

const createLifecycleHelpers = ({
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
  const baseRange = (endpoint: 'min' | 'max') =>
    page.locator(`[data-testid="base-image-range-${endpoint}"] input`);
  const visibility = (image: 'base-image' | 'layer') =>
    page.locator(`[data-testid="${image}-visibility"]`);
  const captureSlices = () =>
    utils.capture2DViewScreenshotMetrics('slice-lifecycle.png');
  const captureSlicePixels = () =>
    utils.captureViewPixels(
      '[data-testid~="vtk-two-view"]',
      40,
      'slice-lifecycle.png'
    );
  const captureOblique = (fileName = 'slice-lifecycle-oblique.png') =>
    utils.captureViewPixels(obliqueSlices, 40, fileName);
  const moveToHeader = () => utils.moveToElement(page.locator('header'));

  async function showInAllViews(name = baseName) {
    await page.locator('[data-testid="module-tab-Data"]').click();
    await utils.waitForModuleTransitions();
    await utils.showInAllViews(
      page.locator('.image-list-card', { hasText: containsText(name) }).first()
    );
  }

  async function setBaseRange(minimum: number, maximum: number) {
    await baseRange('min').evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await setValueVueInput(baseRange('min'), String(minimum));
    await setValueVueInput(baseRange('max'), String(maximum));
    await page.keyboard.press('Enter');
  }

  async function expectBaseSettings() {
    await expect(baseRange('min')).toHaveAttribute('title', '20');
    await expect(baseRange('max')).toHaveAttribute('title', '200');
    await expect(
      page.locator('[data-testid="base-image-colormap"]')
    ).toContainText('DICOM Hot Iron');
    for (const view of await page
      .locator(`[data-testid~="vtk-two-view"], ${obliqueSlices}`)
      .all())
      await expect(view).toContainText('W/L: 180.00 / 110.00');
  }

  async function expectColoredSlices(count: number) {
    await moveToHeader();
    await expect
      .poll(async () => {
        const pixels = await captureSlices();
        return (
          pixels.length === count &&
          pixels.every(({ colored }) => colored > 1000)
        );
      })
      .toBe(true);
  }

  async function expectSlicesMatch(
    expected: Awaited<ReturnType<typeof captureSlicePixels>>
  ) {
    await moveToHeader();
    await expect
      .poll(
        async () => {
          const pixels = await captureSlicePixels();
          return (
            pixels.length === expected.length &&
            pixels.every(
              ({ width, data }, index) =>
                width === expected[index].width &&
                data.equals(expected[index].data)
            )
          );
        },
        { message: 'Expected restored slice colors and zoom to match' }
      )
      .toBe(true);
  }

  async function openDisplay(layout: 'Four Up' | 'flat' | 'grid' = 'Four Up') {
    const base = utils.writeMetaImage(baseName);
    const overlay = utils.writeMetaImage(overlayName, { step: 29 });
    await utils.writeManifestToFile(
      {
        ...layeredImageManifest(base, overlay),
        ...(layout === 'flat'
          ? {
              layout: {
                direction: 'row',
                items: [0, 1].map((slotIndex) => ({ type: 'slot', slotIndex })),
              },
              layoutSlots: ['left', 'right'],
              activeView: 'left',
              viewByID: Object.fromEntries(
                ['left', 'right'].map((id) => [
                  id,
                  {
                    id,
                    type: '2D',
                    name: 'Axial',
                    dataID: 'base',
                    options: { orientation: 'Axial' },
                  },
                ])
              ),
            }
          : {}),
        layerDisplay: {
          'base::overlay': {
            preset: 'Cool to Warm',
            mappingRange: [0, 255],
            opacity: 0.35,
            transparentBackground: false,
          },
        },
      },
      'slice-lifecycle.json'
    );
    await utils.openVolViewPage('slice-lifecycle.json');
    if (layout === 'flat') await volview.waitForViewCounts(2, false);
    else await utils.selectLayout('Four Up', 3, true);
    if (layout === 'grid') await utils.selectGrid(4, 4);
    await showInAllViews();
    await layerDisplay.openLayerDisplayControls();
    const palette = page.locator('[data-testid="base-image-colormap"]');
    await palette.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await palette.click();
    const option = page
      .locator('[role="option"]', { hasText: containsText('DICOM Hot Iron') })
      .first();
    await option.evaluate((element) =>
      element.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    );
    await option.click();
    await setBaseRange(20, 200);
    await expectBaseSettings();
    await expectColoredSlices({ flat: 2, 'Four Up': 3, grid: 4 }[layout]);
  }

  async function toggleVisibility(image: 'base-image' | 'layer') {
    await visibility(image).evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await visibility(image).click();
    await moveToHeader();
  }

  return {
    visibility,
    captureSlices,
    captureSlicePixels,
    captureOblique,
    moveToHeader,
    showInAllViews,
    setBaseRange,
    expectBaseSettings,
    expectColoredSlices,
    expectSlicesMatch,
    openDisplay,
    toggleVisibility,
  };
};

test.describe('Slice display lifecycle', () => {
  test('preserves distinct zoom and appearance when maximizing either slice in a flat layout', async ({
    page,
    volview,
    utils,
    layerDisplay,
  }) => {
    const {
      captureSlices,
      captureSlicePixels,
      moveToHeader,
      setBaseRange,
      expectBaseSettings,
      expectColoredSlices,
      expectSlicesMatch,
      openDisplay,
      toggleVisibility,
    } = createLifecycleHelpers({ page, volview, utils, layerDisplay });
    await openDisplay('flat');
    const fittedPixels = await captureSlicePixels();
    for (const index of [0, 1]) {
      const unzoomed = await captureSlices();
      const box = await volview.views2D
        .nth(index)
        .locator('canvas')
        .boundingBox();
      if (!box) throw new Error('The view has no canvas on screen');
      const centerX = Math.round(box.x + box.width / 2);
      const centerY = Math.round(box.y + box.height / 2);
      await page.mouse.move(centerX, centerY);
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(centerX, centerY + 40 + index * 25);
      await page.mouse.up({ button: 'right' });
      await moveToHeader();
      await expect
        .poll(
          async () =>
            Math.abs(
              (await captureSlices())[index].colored - unzoomed[index].colored
            ) > 1000,
          { message: 'Expected the zoom gesture to change the image area' }
        )
        .toBe(true);
    }
    const zoomed = await captureSlices();
    expect(zoomed[0].colored).not.toBe(zoomed[1].colored);
    const zoomedPixels = await captureSlicePixels();
    for (const index of [0, 1]) {
      await volview.views2D.nth(index).dblclick();
      await volview.waitForViewCounts(1, false);
      await expectColoredSlices(1);
      await volview.views2D.first().dblclick();
      await volview.waitForViewCounts(2, false);
      await expectSlicesMatch(zoomedPixels);
      await expectBaseSettings();
    }

    const resetButtons = page.locator('.vtk-gutter button');
    await expect(resetButtons).toHaveCount(2);
    for (const button of await resetButtons.all()) await button.click();
    await expectSlicesMatch(fittedPixels);

    const beforeRange = await captureSlices();
    await setBaseRange(60, 180);
    await moveToHeader();
    await expect
      .poll(async () =>
        (await captureSlices()).every(
          ({ checksum }, index) => checksum !== beforeRange[index].checksum
        )
      )
      .toBe(true);
    const withOverlay = await captureSlices();
    const withOverlayPixels = await captureSlicePixels();
    await toggleVisibility('layer');
    await expect
      .poll(async () =>
        (await captureSlices()).every(
          ({ checksum }, index) => checksum !== withOverlay[index].checksum
        )
      )
      .toBe(true);
    await toggleVisibility('layer');
    await expectSlicesMatch(withOverlayPixels);
  });

  test('inherits base palette, window and visibility in newly created grid slots', async ({
    page,
    volview,
    utils,
    layerDisplay,
  }) => {
    const {
      visibility,
      captureSlices,
      moveToHeader,
      showInAllViews,
      expectBaseSettings,
      expectColoredSlices,
      openDisplay,
      toggleVisibility,
    } = createLifecycleHelpers({ page, volview, utils, layerDisplay });
    await openDisplay('grid');
    await toggleVisibility('layer');
    await expectColoredSlices(4);
    await toggleVisibility('base-image');
    await expect(visibility('base-image')).toContainText('SHOW', {
      useInnerText: true,
    });
    await utils.selectGrid(7, 6);
    await showInAllViews();
    await volview.waitForViewCounts(6, false);
    await layerDisplay.openLayerDisplayControls();
    await expectBaseSettings();
    await expect(visibility('base-image')).toContainText('SHOW', {
      useInnerText: true,
    });
    await moveToHeader();
    await expect
      .poll(async () => {
        const pixels = await captureSlices();
        return (
          pixels.length === 6 && pixels.every(({ colored }) => colored < 100)
        );
      })
      .toBe(true);
    await toggleVisibility('base-image');
    await expectColoredSlices(6);
    await expectBaseSettings();
  });

  test('keeps base palette and window through a grid picked while another image shows', async ({
    page,
    volview,
    utils,
    layerDisplay,
  }) => {
    const { showInAllViews, expectBaseSettings, openDisplay } =
      createLifecycleHelpers({ page, volview, utils, layerDisplay });
    await openDisplay();
    await showInAllViews(overlayName);
    await utils.selectGrid(4, 4);
    await showInAllViews();
    await layerDisplay.openLayerDisplayControls();
    await expectBaseSettings();
  });

  test('keeps base and overlay rendering live through repeated layout replacement', async ({
    page,
    volview,
    utils,
    layerDisplay,
  }) => {
    const {
      captureSlicePixels,
      captureOblique,
      moveToHeader,
      expectBaseSettings,
      expectColoredSlices,
      expectSlicesMatch,
      openDisplay,
      toggleVisibility,
    } = createLifecycleHelpers({ page, volview, utils, layerDisplay });
    await openDisplay();
    const fourUp = await captureSlicePixels();
    const errors: string[] = [];

    const onLog = (text: string | null) => {
      if (
        text &&
        /instance deleted - cannot call any method|(?:deleted|disposed).*(?:VTK|renderer|mapper|actor)|WebGL.*(?:INVALID_|CONTEXT_LOST|error)|(?:shader|program).*(?:error|failed)|(?:error|failed|could not).*(?:shader|WebGL)/i.test(
          text
        )
      )
        errors.push(text);
    };
    const onConsole = (message: { text: () => string }) =>
      onLog(message.text());
    const onPageError = (error: Error) => onLog(error.message);

    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    try {
      for (let cycle = 0; cycle < 2; cycle++) {
        await volview.views2D.nth(cycle).dblclick();
        await volview.waitForViewCounts(1, false);
        await expectColoredSlices(1);
        await volview.views2D.first().dblclick();
        await volview.waitForViewCounts(3, true);
        await expectSlicesMatch(fourUp);
        await utils.selectLayout('3D Only', 0, true);
        await volview.layoutButton.click();
        await page
          .locator('.v-list-item-title', { hasText: exactText('Oblique') })
          .click();
        await expect(page.locator('.oblique-grid')).toBeVisible();
        await waitForTransitions(page.locator('.oblique-grid'));
        await expectBaseSettings();
        await moveToHeader();
        await expect
          .poll(async () => {
            const pixels = await captureOblique();
            return (
              pixels.length === 3 &&
              pixels.every(({ data }) => coloredPixelCount(data) > 1000)
            );
          })
          .toBe(true);
        const baseImages = await captureOblique(
          `slice-lifecycle-oblique-before-${cycle}.png`
        );
        await toggleVisibility('base-image');
        await expect
          .poll(async () => {
            const pixels = await captureOblique(
              `slice-lifecycle-oblique-hidden-${cycle}.png`
            );
            return (
              pixels.length === 3 &&
              pixels.every(
                ({ data }, index) =>
                  coloredPixelCount(data) <
                  coloredPixelCount(baseImages[index].data) / 3
              )
            );
          })
          .toBe(true);
        await toggleVisibility('base-image');
        await expect
          .poll(
            async () => {
              const pixels = await captureOblique(
                `slice-lifecycle-oblique-restored-${cycle}.png`
              );
              return (
                pixels.length === 3 &&
                pixels.every(({ data }, index) =>
                  data.equals(baseImages[index].data)
                )
              );
            },
            {
              message:
                'Expected restored oblique slices to match their visible appearance',
            }
          )
          .toBe(true);
        await utils.selectLayout('Four Up', 3, true);
        await expectSlicesMatch(fourUp);
      }
      expect(errors).toEqual([]);
    } finally {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
    }
  });
});
