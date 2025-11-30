import { DOWNLOAD_TIMEOUT } from '@/wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import { openUrls } from './utils';
import { PROSTATEX_DATASET, MRA_HEAD_NECK_DATASET } from './configTestUtils';

describe('Layers and Rendering', () => {
  it('should show 3D rendering controls regardless of active view', async () => {
    await openUrls([PROSTATEX_DATASET]);

    await volViewPage.waitForViews();

    const renderTab = volViewPage.renderingModuleTab;
    await renderTab.click();

    const view3D = await volViewPage.getView3D();

    const volumeRenderingSection =
      await volViewPage.getVolumeRenderingSection();
    await expect(volumeRenderingSection).toExist();
    await expect(volumeRenderingSection).toBeDisplayed();

    const pwfCanvas = await $('div.pwf-editor canvas');
    await expect(pwfCanvas).toExist();

    await view3D!.click();
    await expect(volumeRenderingSection).toBeDisplayed();

    const view2D = await volViewPage.getView2D();
    await view2D!.click();

    await expect(volumeRenderingSection).toBeDisplayed();
    await expect(pwfCanvas).toExist();
  });

  it('should create overlay with 2 DICOM images', async () => {
    await openUrls([PROSTATEX_DATASET, MRA_HEAD_NECK_DATASET]);

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
    const firstView2D = views2D[0];
    const result = await browser.checkElement(
      firstView2D,
      'layers_max_opacity_2d_view'
    );

    const THRESHOLD = 5; // percent
    await expect(result).toBeLessThan(THRESHOLD);
  });
});
