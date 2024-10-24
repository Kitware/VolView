import { DOWNLOAD_TIMEOUT } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import { openUrls } from './utils';

describe('Add Layer button', () => {
  it('should create overlay with 2 DICOM images', async () => {
    await openUrls([
      {
        url: 'https://data.kitware.com/api/v1/item/63527c7311dab8142820a338/download',
        name: 'prostate.zip',
      },
      {
        url: 'https://data.kitware.com/api/v1/item/6352a2b311dab8142820a33b/download',
        name: 'MRA-Head_and_Neck.zip',
      },
    ]);

    // Wait for both volumes to appear in list
    await browser.waitUntil(
      async () => {
        const menus = await volViewPage.datasetMenuButtons;
        return menus.length >= 2;
      },
      {
        timeout: DOWNLOAD_TIMEOUT,
        timeoutMsg: `Expected 2 volumes to appear in list`,
      }
    );

    // Wait for a primary selection
    await volViewPage.waitForViews();
    // kludge for CI (dataset not seen as layerable yet without?)
    await browser.pause(15000);

    const menus = await volViewPage.datasetMenuButtons;
    await menus[1].click();
    await browser.waitUntil(
      async () => {
        const addLayerButton = await $(
          'div[data-testid="dataset-menu-layer-item"]'
        );
        return addLayerButton.isClickable();
      },
      { timeoutMsg: 'Expected clickable Add Layer button' }
    );

    const addLayerButton = await $(
      'div[data-testid="dataset-menu-layer-item"]'
    );
    await addLayerButton.click();

    const renderTab = await volViewPage.renderingModuleTab;
    await renderTab.click();

    // need to wait a little for layer section to render
    await browser.waitUntil(
      async function slidersExist() {
        const layerOpacitySliders = await volViewPage.layerOpacitySliders;
        return layerOpacitySliders.length > 0;
      },
      {
        timeoutMsg: `Expected at least one layer opacity slider`,
      }
    );
  });
});
