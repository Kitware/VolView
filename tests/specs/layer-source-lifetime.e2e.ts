import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { containsText, type VolViewPage } from '../pageobjects/volview.page';

const MENU_BUTTON = '[data-testid="dataset-menu-button"]';
const MENU_ITEM = '[data-testid="dataset-menu-layer-item"]';

const cardFor = async (page: Page, name: string) => {
  const card = page.locator('.image-list-card', {
    hasText: containsText(name),
  });
  await expect(card).toBeVisible();
  await expect(card).toBeEnabled();
  return card;
};

// The menu stays open after an item is picked, so opening one requires
// closing whatever is already on screen.
const clickDatasetMenuItem = async (
  page: Page,
  name: string,
  itemText: string
) => {
  await page.keyboard.press('Escape');
  await expect(
    page.locator(MENU_ITEM),
    'Expected any open dataset menu to close'
  ).toHaveCount(0);

  await (await cardFor(page, name)).locator(MENU_BUTTON).click();
  // While a layer builds, the item renders a spinner instead of its label.
  const item = page.locator(MENU_ITEM, { hasText: containsText(itemText) });
  await item.click();
};

// The opacity slider appears once the layer image is in the cache, and the
// dataset menus live on the Data tab, so step back after checking.
const waitForLayerBuilt = async (page: Page, volview: VolViewPage) => {
  await volview.renderingModuleTab.click();
  await expect
    .poll(() => volview.layerOpacitySliders.count(), {
      message: 'Expected the layer to finish building',
    })
    .toBeGreaterThan(0);
  await page.locator('button[data-testid="module-tab-Data"]').click();
};

test.describe('An image used as a layer of another image', () => {
  test('can be layered again after the layer is removed', async ({
    page,
    volview,
    utils,
  }) => {
    // Matching grids, so building the layer reuses the source image rather
    // than resampling it.
    const parentName = utils.writeMetaImage(`layer-parent-${Date.now()}.mha`);
    const sourceName = utils.writeMetaImage(`layer-source-${Date.now()}.mha`, {
      step: 29,
    });
    const manifestName = `layer-source-lifetime-${Date.now()}.json`;
    await utils.writeManifestToFile(
      {
        resources: [
          { url: `/tmp/${parentName}`, name: parentName },
          { url: `/tmp/${sourceName}`, name: sourceName },
        ],
      },
      manifestName
    );

    await utils.openVolViewPage(manifestName);
    await (await cardFor(page, parentName)).click();

    await clickDatasetMenuItem(page, sourceName, 'Add as layer');
    await waitForLayerBuilt(page, volview);
    await clickDatasetMenuItem(page, sourceName, 'Remove as layer');

    // Rebuilding reads the source image again, which fails once removing the
    // layer has released the image the source dataset still owns.
    await clickDatasetMenuItem(page, sourceName, 'Add as layer');

    await waitForLayerBuilt(page, volview);
    expect(await volview.getNotificationsCount()).toEqual(0);
  });
});
