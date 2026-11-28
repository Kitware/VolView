import { test, expect } from '../fixtures';
import { PROSTATEX_DATASET } from '../datasets';

// Measured: the 3D view alone differs in 0.8% of pixels between runs, and one
// axial slice step changes 2.2%.
const THRESHOLD = 0.015;

test.describe('VolView', () => {
  test('should load and render a sample dataset', async ({
    page,
    volview,
    utils,
  }) => {
    await utils.useCachedSample(PROSTATEX_DATASET);

    await volview.open();
    await volview.downloadProstateSample();

    await volview.waitForViewCounts(3, true);
    await volview.waitForViewsLoaded();

    const layoutContainer = page.locator('.layout-container').first();

    await expect(
      layoutContainer,
      `Visual comparison exceeded ${THRESHOLD * 100}% threshold`
    ).toHaveScreenshot('prostate_sample_views.png', {
      maxDiffPixelRatio: THRESHOLD,
    });
  });
});
