import AppPage from '../pageobjects/volview.page';

// handle pixel jitter in 3D view
const THRESHOLD = 12; // percent

describe('VolView', () => {
  it('should load and render a sample dataset', async () => {
    await AppPage.open();
    await AppPage.downloadProstateSample();
    await AppPage.waitForViews();
    await browser.pause(5000);

    const layoutContainer = await $('.layout-container');

    const result = await browser.checkElement(
      layoutContainer,
      'prostate_sample_views'
    );

    await expect(result).toBeLessThan(THRESHOLD);
  });
});
