import AppPage from '../pageobjects/volview.page';

const THRESHOLD = 12; // percent - handle pixel jitter in 3D view
const RENDER_STABLE_TIMEOUT = 5000;

describe('VolView', () => {
  it('should load and render a sample dataset', async () => {
    await AppPage.open();
    await AppPage.downloadProstateSample();
    await AppPage.waitForViews();

    const layoutContainer = await $('.layout-container');

    await browser.waitUntil(
      async () => {
        const result = await browser.checkElement(
          layoutContainer,
          'prostate_sample_views'
        );
        return (result as number) < THRESHOLD;
      },
      {
        timeout: RENDER_STABLE_TIMEOUT,
        interval: 500,
        timeoutMsg: `Visual comparison exceeded ${THRESHOLD}% threshold after ${RENDER_STABLE_TIMEOUT}ms`,
      }
    );
  });
});
