import * as fs from 'fs';
import * as path from 'path';
import { cleanuptotal } from 'wdio-cleanuptotal-service';
import { DOWNLOAD_TIMEOUT, FIXTURES, TEMP_DIR } from '@/wdio.shared.conf';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import {
  openUrls,
  openVolViewPage,
  waitForModuleTransitions,
  writeManifestToFile,
} from './utils';
import { PROSTATEX_DATASET } from '../datasets';

const openLayeringFixtures = async () => {
  const fixtureNames = ['prostate-3-slices.zip', 'mra-head-neck-3-slices.zip'];
  await Promise.all(
    fixtureNames.map(async (name) => {
      const target = path.join(TEMP_DIR, name);
      await fs.promises.copyFile(path.join(FIXTURES, 'layering', name), target);
      cleanuptotal.addCleanup(async () => {
        fs.unlinkSync(target);
      });
    })
  );

  const manifestName = `layering-fixtures-${Date.now()}.json`;
  await writeManifestToFile(
    {
      resources: fixtureNames.map((name) => ({ url: `/tmp/${name}` })),
    },
    manifestName
  );
  await openVolViewPage(manifestName);
};

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

    const volumePanel = $('[data-testid="volume-rendering-panel"]');
    const toggle = $('[data-testid="volume-rendering-toggle"]');
    const presets = volumePanel.$('.v-expansion-panel-title*=Color Presets');
    const cinematic = volumePanel.$(
      '.v-expansion-panel-title*=Cinematic Rendering'
    );
    const shift = volumePanel
      .$('.mapping-range-editor .v-slider')
      .$('[role="slider"]');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(presets).toBeDisplayed();
    await expect(cinematic).toBeDisplayed();
    const initialShift = await shift.getAttribute('aria-valuenow');
    await shift.execute((element) => element.focus());
    await browser.keys('ArrowRight');
    await expect(shift).not.toHaveAttribute(
      'aria-valuenow',
      initialShift ?? ''
    );
    const editedShift = await shift.getAttribute('aria-valuenow');
    if (editedShift === null) throw new Error('Expected a displayed 3D shift');

    await toggle.scrollIntoView({ block: 'center', behavior: 'instant' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await waitForModuleTransitions();
    await expect(pwfCanvas).not.toBeDisplayed();
    await expect(presets).not.toBeDisplayed();
    await expect(cinematic).not.toBeDisplayed();
    const minimum = $('[data-testid="base-image-range-min"] input');
    const maximum = $('[data-testid="base-image-range-max"] input');
    await expect(minimum).toBeDisplayed();
    await expect(minimum).toBeEnabled();
    await setValueVueInput(minimum, '0');
    await setValueVueInput(maximum, '100');
    await browser.keys('Enter');
    for (const view of await volViewPage.getViews2D())
      await expect(view).toHaveText(
        expect.stringContaining('W/L: 100.00 / 50.00')
      );

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await waitForModuleTransitions();
    await expect(pwfCanvas).toBeDisplayed();
    await expect(presets).toBeDisplayed();
    await expect(cinematic).toBeDisplayed();
    await expect(shift).toHaveAttribute('aria-valuenow', editedShift);
    await expect(minimum).toHaveAttribute('title', '0');
    await expect(maximum).toHaveAttribute('title', '100');
  });

  it('should create overlay with 2 DICOM images', async () => {
    await openLayeringFixtures();

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

    const mraCard = await $('.volume-card[html-title^="**TOF"]');
    await mraCard.click();

    const inactiveMenuSelector =
      '.volume-card:not(.volume-card-active) button[data-testid="dataset-menu-button"]';

    await browser.waitUntil(
      async () => {
        const activeMenus = await $$(
          '.volume-card-active button[data-testid="dataset-menu-button"]'
        );
        const inactiveMenus = await $$(inactiveMenuSelector);
        return (
          (await activeMenus.length) >= 1 && (await inactiveMenus.length) >= 1
        );
      },
      {
        timeout: DOWNLOAD_TIMEOUT,
        timeoutMsg:
          'Expected active and inactive datasets to be available for layering',
      }
    );

    const inactiveMenus = await $$(inactiveMenuSelector);
    await inactiveMenus[0].click();

    await browser.waitUntil(
      async () => {
        const addLayerButton = await $(
          'div[data-testid="dataset-menu-layer-item"]'
        );
        return addLayerButton.isClickable();
      },
      {
        timeout: DOWNLOAD_TIMEOUT,
        timeoutMsg: 'Expected clickable Add Layer button',
      }
    );

    const addLayerButton = await $(
      'div[data-testid="dataset-menu-layer-item"]'
    );
    await addLayerButton.click();

    const renderTab = await volViewPage.renderingModuleTab;
    await renderTab.click();

    await browser.waitUntil(
      async function slidersExist() {
        const layerOpacitySliders = await volViewPage.layerOpacitySliders;
        return (await layerOpacitySliders.length) > 0;
      },
      {
        timeoutMsg: `Expected at least one layer opacity slider`,
      }
    );

    const minimum = $('[data-testid="layer-range-min"] input');
    const maximum = $('[data-testid="layer-range-max"] input');
    await minimum.waitForEnabled();
    await waitForModuleTransitions();
    // The resampled fixture spans scalar values 0 through 763.
    await setValueVueInput(minimum, '0');
    await setValueVueInput(maximum, '763');
    await expect(minimum).toHaveAttribute('title', '0');
    await expect(maximum).toHaveAttribute('title', '763');

    const layerOpacitySliders = await volViewPage.layerOpacitySliders;
    const firstSlider = layerOpacitySliders[0];
    const sliderThumb = await firstSlider.$('[role="slider"]');
    const inputElement = await firstSlider.$('input');
    const views2D = await volViewPage.getViews2D();
    const viewCount = await views2D.length;
    if (!views2D || viewCount === 0) {
      throw new Error('Could not find 2D views for screenshot');
    }
    const firstView2D = views2D[0];
    const beforeOpacityChange = await firstView2D.takeScreenshot();

    await browser.execute((element) => {
      (element as HTMLElement).focus();
    }, sliderThumb);

    await browser.keys('End');

    await browser.waitUntil(
      async () => {
        const value = await inputElement.getValue();
        return value === '1';
      },
      {
        timeoutMsg: 'Expected slider value to be 1',
        timeout: 5000,
      }
    );

    await browser.waitUntil(
      async () => (await firstView2D.takeScreenshot()) !== beforeOpacityChange,
      {
        timeout: 5000,
        timeoutMsg: 'Expected the 2D view to render the opacity change',
      }
    );

    const result = await browser.checkElement(
      firstView2D,
      'layers_max_opacity_2d_view',
      {
        pixelmatch: { threshold: 0.2 },
        // Compare where the resampled prostate layer intersects the MRA.
        blockOut: [
          { x: 0, y: 0, width: 371, height: 130 },
          { x: 0, y: 240, width: 371, height: 92 },
          { x: 0, y: 130, width: 20, height: 110 },
          { x: 340, y: 130, width: 31, height: 110 },
        ],
      }
    );

    const THRESHOLD = 1; // percent
    await expect(result).toBeLessThan(THRESHOLD);
  });
});
