import { test, expect } from '../fixtures';
import { FETUS_DATASET } from '../datasets';

test.describe('Automatic Layering by File Name', () => {
  test('should automatically layer files matching the layer extension pattern', async ({
    volview,
    utils,
  }) => {
    const config = {
      io: {
        layerExtension: 'layer',
      },
    };

    const configFileName = 'automatic-layering-config.json';
    await utils.writeManifestToFile(config, configFileName);

    await volview.open(
      `?urls=[tmp/${FETUS_DATASET.name},tmp/${FETUS_DATASET.name},tmp/${configFileName}]&names=[base-image.mha,base-image.layer.mha,${configFileName}]`
    );
    await volview.waitForViews();

    const renderTab = volview.renderingModuleTab;
    await renderTab.click();

    await expect
      .poll(() => volview.layerOpacitySliders.count(), {
        message: `Expected at least one layer opacity slider to verify automatic layering`,
      })
      .toBeGreaterThan(0);
  });
});
