import { DOWNLOAD_TIMEOUT } from '@/wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import { FETUS_DATASET } from './configTestUtils';
import { writeManifestToFile } from './utils';

describe('Automatic Layering by File Name', () => {
  it('should automatically layer files matching the layer extension pattern', async () => {
    const config = {
      io: {
        layerExtension: 'layer',
      },
    };

    const configFileName = 'automatic-layering-config.json';
    await writeManifestToFile(config, configFileName);

    await volViewPage.open(
      `?config=[tmp/${configFileName}]&urls=[${FETUS_DATASET.url},${FETUS_DATASET.url}]&names=[base-image.mha,base-image.layer.mha]`
    );
    await volViewPage.waitForViews();

    const renderTab = await volViewPage.renderingModuleTab;
    await renderTab.click();

    await browser.waitUntil(
      async function layerSlidersExist() {
        const layerOpacitySliders = await volViewPage.layerOpacitySliders;
        return (await layerOpacitySliders.length) > 0;
      },
      {
        timeout: DOWNLOAD_TIMEOUT,
        timeoutMsg: `Expected at least one layer opacity slider to verify automatic layering`,
      }
    );
  });
});
