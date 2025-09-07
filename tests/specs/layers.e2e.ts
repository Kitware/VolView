import { DOWNLOAD_TIMEOUT } from '@/wdio.shared.conf';
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

    await browser.waitUntil(
      async () => {
        const menus = await volViewPage.datasetMenuButtons;
        return (await menus.length) >= 2;
      },
      {
        timeout: DOWNLOAD_TIMEOUT,
        timeoutMsg: 'Expected at least 2 dataset menu buttons to be available',
      }
    );

    const menus = await volViewPage.datasetMenuButtons;
    const menuCount = await menus.length;
    if (menuCount < 2) {
      throw new Error(
        `Expected at least 2 dataset menu buttons, but found ${menuCount}`
      );
    }
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
        return (await layerOpacitySliders.length) > 0;
      },
      {
        timeoutMsg: `Expected at least one layer opacity slider`,
      }
    );

    const layerOpacitySliders = await volViewPage.layerOpacitySliders;
    const firstSlider = layerOpacitySliders[0];

    await firstSlider.click();

    // Use keyboard to set to maximum (End key goes to max)
    await browser.keys('End');

    await browser.waitUntil(
      async () => {
        const inputElement = await firstSlider.$('input');
        const value = await inputElement.getValue();
        return value === '1';
      },
      {
        timeoutMsg: 'Expected slider value to be 1 (max opacity)',
        timeout: 5000,
      }
    );

    const views2D = await volViewPage.getViews2D();
    const viewCount = await views2D.length;
    if (!views2D || viewCount === 0) {
      throw new Error('Could not find 2D views for screenshot');
    }
    const lastView2D = views2D[viewCount - 1];
    const result = await browser.checkElement(
      lastView2D,
      'layers_max_opacity_2d_view'
    );

    const THRESHOLD = 5; // percent
    await expect(result).toBeLessThan(THRESHOLD);
  });
});
