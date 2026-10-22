import { capture2DViewPixels } from './utils';
import { openOverlaySegmentationFixture } from './overlaySegmentationTestUtils';

const captureSlice = async (fileName: string) =>
  (await capture2DViewPixels(80, fileName))[0].data;

describe('Overlay opacity with segmentation', () => {
  it('keeps segmentation colors continuous when opacity reaches 100%', async () => {
    await openOverlaySegmentationFixture('opacity');
    const opacity = $('[data-testid="layer-opacity-slider"] [role="slider"]');
    await opacity.scrollIntoView({ block: 'center', behavior: 'instant' });
    await opacity.execute((element) => element.focus());
    await browser.keys(['End']);
    await browser.keys(['ArrowLeft']);
    await expect(
      $('[data-testid="layer-opacity-slider"] [role="slider"]')
    ).toHaveAttribute('aria-valuenow', '0.99');
    await $('header').moveTo();
    await browser.execute(async () => {
      const transitions = document
        .getAnimations()
        .filter((animation) =>
          Number.isFinite(animation.effect?.getComputedTiming().endTime)
        );
      await Promise.allSettled(
        transitions.map((animation) => animation.finished)
      );
    });
    await $('[data-testid~="vtk-two-view"]').waitForStable();
    let below: number[] = [];
    let background: number[] = [];
    await browser.waitUntil(
      async () => {
        below = await captureSlice('overlay-opacity-99.png');
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
        timeoutMsg:
          'Expected a blue segmentation and 1% of the white base beneath the black overlay',
      }
    );
    await opacity.execute((element) => element.focus());
    await browser.keys('End');
    await expect(
      $('[data-testid="layer-opacity-slider"] [role="slider"]')
    ).toHaveAttribute('aria-valuenow', '1');
    await expect($('[data-testid="layer-opacity-slider"] input')).toHaveValue(
      '1'
    );
    await $('header').moveTo();
    // At full opacity the white base contributes nothing. Requiring the
    // background's green and blue channels to reach zero excludes a stale
    // 99% frame, even when the controls update before the next render.
    await browser.waitUntil(
      async () => {
        const full = await captureSlice('overlay-opacity-100.png');
        return (
          full.length === below.length &&
          background.every(
            (index) => full[index + 1] === 0 && full[index + 2] === 0
          ) &&
          full.every((value, index) => Math.abs(value - below[index]) <= 4)
        );
      },
      {
        timeoutMsg:
          'Expected 99% to 100% opacity to preserve segmentation colors without a render-pass jump',
      }
    );
  });
});
