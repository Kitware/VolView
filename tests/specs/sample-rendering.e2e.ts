import AppPage from '../pageobjects/volview.page';
import { PROSTATEX_DATASET } from '../datasets';

const THRESHOLD = 12; // percent - handle pixel jitter in 3D view
const RENDER_STABLE_TIMEOUT = 5000;

describe('VolView', () => {
  it('should load and render a sample dataset', async () => {
    // The sample's address is compiled into the app, so hand it the cached
    // copy. A network intercept is not an option: registering one stalls the
    // app's workers.
    await browser.addInitScript(
      (remote, local) => {
        const original = window.fetch;
        window.fetch = (input, init) =>
          original(input === remote ? local : input, init);
      },
      PROSTATEX_DATASET.url,
      `/tmp/${PROSTATEX_DATASET.name}`
    );

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
