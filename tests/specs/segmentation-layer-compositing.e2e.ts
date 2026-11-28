import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { holdKey, waitForTransitions } from '../pageobjects/volview.page';
import type { SegmentationUtils } from './segmentationTestUtils';
import type { Utils } from './utils';

const colors = async (utils: Utils) => {
  const [{ data }] = await utils.capture2DViewPixels(
    80,
    'segmentation-layer-compositing.png'
  );
  const counts = { blue: 0, halfBlue: 0, pastelBlue: 0, black: 0 };
  for (let i = 0; i < data.length; i += 4) {
    const [red, green, blue] = data.slice(i, i + 3);
    if (red <= 2 && green <= 2 && blue >= 250) counts.blue++;
    if (red <= 2 && green <= 2 && blue >= 125 && blue <= 130) counts.halfBlue++;
    if (red >= 125 && red <= 130 && green >= 125 && green <= 130 && blue >= 250)
      counts.pastelBlue++;
    if (red <= 2 && green <= 2 && blue <= 2) counts.black++;
  }
  return counts;
};

type Counts = Awaited<ReturnType<typeof colors>>;

const waitForColors = async (
  { page, utils }: { page: Page; utils: Utils },
  matches: (counts: Counts) => boolean,
  message: string
) => {
  await utils.moveToElement(page.locator('header'));
  await utils.waitForModuleTransitions();
  await waitForTransitions(
    page.locator('[data-testid~="vtk-two-view"]').first()
  );
  await expect
    .poll(async () => matches(await colors(utils)), { message })
    .toBe(true);
};

const setFill = async (
  { page, utils }: { page: Page; utils: Utils },
  segmentation: SegmentationUtils,
  value: 0 | 0.5 | 1
) => {
  await segmentation.openAnnotationSegments();
  const display = page.locator('[data-testid="segment-display-section"]');
  if ((await display.getAttribute('aria-expanded')) !== 'true')
    await display.click();
  await utils.waitForModuleTransitions();
  const slider = page.locator(
    '.display-controls .v-slider:has(input[name="Fill Opacity"]) [role="slider"]'
  );
  await slider.evaluate((element) =>
    element.scrollIntoView({ block: 'center', behavior: 'instant' })
  );
  await slider.focus();
  if (value === 1) await page.keyboard.press('End');
  else {
    await page.keyboard.press('Home');
    await holdKey(page, 'ArrowRight', value * 100);
  }
  await expect(slider).toHaveAttribute('aria-valuenow', String(value));
};

test.describe('Segmentation above image overlays', () => {
  test('composites fill and outlines over the image layer through display changes', async ({
    page,
    volview,
    utils,
    segmentation,
    overlaySegmentation,
  }) => {
    const view = { page, utils };
    await overlaySegmentation.openOverlaySegmentationFixture('compositing');
    const opacity = page.locator(
      '[data-testid="layer-opacity-slider"] [role="slider"]'
    );
    await opacity.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await opacity.focus();
    await page.keyboard.press('End');
    await expect(opacity).toHaveAttribute('aria-valuenow', '1');

    await setFill(view, segmentation, 1);
    await waitForColors(
      view,
      ({ blue, black }) => blue > 2000 && black > 2000,
      'Expected opaque blue segment fill above the full-opacity black image layer'
    );
    const opaque = await colors(utils);

    await setFill(view, segmentation, 0.5);
    await waitForColors(
      view,
      ({ blue, halfBlue }) => blue > 100 && halfBlue > 2000,
      'Expected 50% blue fill over black while the outline stays fully blue'
    );
    await volview.renderingModuleTab.click();
    const visibility = page.locator('[data-testid="layer-visibility"]');
    await visibility.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await visibility.click();
    await expect(visibility).toContainText('SHOW', { useInnerText: true });
    await waitForColors(
      view,
      ({ blue, pastelBlue }) => blue > 100 && pastelBlue > 2000,
      'Expected transparent blue fill to blend with the white base when the image layer is hidden'
    );
    await visibility.click();
    await expect(visibility).toContainText('HIDE', { useInnerText: true });
    await waitForColors(
      view,
      ({ blue, halfBlue }) => blue > 100 && halfBlue > 2000,
      'Expected showing the image layer to restore the blue-over-black blend'
    );

    await setFill(view, segmentation, 0);
    const outlined = ({ blue, halfBlue, black }: Counts) =>
      blue > 100 &&
      blue < opaque.blue / 4 &&
      halfBlue === 0 &&
      black > opaque.black + opaque.blue / 2;
    await waitForColors(
      view,
      outlined,
      'Expected a fully blue outline and transparent interior above the image layer'
    );
    const row = await segmentation.segmentRow('Blue mask');
    await row.locator('button:has(i.mdi-eye)').click();
    await waitForColors(
      view,
      ({ blue, halfBlue, black }) =>
        blue === 0 && halfBlue === 0 && black > opaque.black + opaque.blue / 2,
      'Expected hiding the segment to remove its outline'
    );
    await row.locator('button:has(i.mdi-eye-off)').click();
    await waitForColors(
      view,
      outlined,
      'Expected showing the segment to restore its outline'
    );

    await utils.selectLayout('3D Only', 0, true);
    await utils.selectLayout('Axial Only', 1, false);
    await waitForColors(
      view,
      outlined,
      'Expected the remounted slice to retain the blue outline'
    );
    await setFill(view, segmentation, 1);
    await waitForColors(
      view,
      ({ blue, black }) => blue > 2000 && black > 2000,
      'Expected the remounted slice to retain opaque fill above the image layer'
    );
  });
});
