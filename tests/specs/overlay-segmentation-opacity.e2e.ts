import { test, expect } from '../fixtures';
import { waitForTransitions } from '../pageobjects/volview.page';
import type { Utils } from './utils';

const captureSlice = async (utils: Utils, fileName: string) =>
  (await utils.capture2DViewPixels(80, fileName))[0].data;

test.describe('Overlay opacity with segmentation', () => {
  test('keeps segmentation colors continuous when opacity reaches 100%', async ({
    page,
    utils,
    overlaySegmentation,
  }) => {
    await overlaySegmentation.openOverlaySegmentationFixture('opacity');
    const opacity = page.locator(
      '[data-testid="layer-opacity-slider"] [role="slider"]'
    );
    await opacity.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await opacity.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await expect(
      page.locator('[data-testid="layer-opacity-slider"] [role="slider"]')
    ).toHaveAttribute('aria-valuenow', '0.99');
    await utils.moveToElement(page.locator('header'));
    await page.evaluate(async () => {
      const transitions = document
        .getAnimations()
        .filter((animation) =>
          Number.isFinite(animation.effect?.getComputedTiming().endTime)
        );
      await Promise.allSettled(
        transitions.map((animation) => animation.finished)
      );
    });
    await waitForTransitions(
      page.locator('[data-testid~="vtk-two-view"]').first()
    );
    let below: number[] = [];
    let background: number[] = [];
    await expect
      .poll(
        async () => {
          below = await captureSlice(utils, 'overlay-opacity-99.png');
          background = [];
          let blue = 0;
          for (let i = 0; i < below.length; i += 4) {
            if (
              below[i + 1] >= 2 &&
              below[i + 1] <= 3 &&
              below[i + 1] === below[i + 2] &&
              below[i] - below[i + 1] <= 16
            )
              background.push(i);
            if (below[i + 2] > below[i] + 40) blue++;
          }
          return background.length > 1000 && blue > 100;
        },
        {
          message:
            'Expected a blue segmentation and 1% of the white base beneath the black overlay',
        }
      )
      .toBe(true);
    await opacity.focus();
    await page.keyboard.press('End');
    await expect(
      page.locator('[data-testid="layer-opacity-slider"] [role="slider"]')
    ).toHaveAttribute('aria-valuenow', '1');
    await expect(
      page.locator('[data-testid="layer-opacity-slider"] input')
    ).toHaveValue('1');
    await utils.moveToElement(page.locator('header'));
    // At full opacity the white base contributes nothing. Requiring the
    // background's green and blue channels to reach zero excludes a stale
    // 99% frame, even when the controls update before the next render.
    await expect
      .poll(
        async () => {
          const full = await captureSlice(utils, 'overlay-opacity-100.png');
          return (
            full.length === below.length &&
            background.every(
              (index) => full[index + 1] === 0 && full[index + 2] === 0
            ) &&
            full.every((value, index) => Math.abs(value - below[index]) <= 4)
          );
        },
        {
          message:
            'Expected 99% to 100% opacity to preserve segmentation colors without a render-pass jump',
        }
      )
      .toBe(true);
  });
});
