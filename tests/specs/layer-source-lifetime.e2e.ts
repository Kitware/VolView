import { volViewPage } from '../pageobjects/volview.page';
import { openVolViewPage, writeManifestToFile, writeMetaImage } from './utils';

const MENU_BUTTON = '[data-testid="dataset-menu-button"]';
const MENU_ITEM = '[data-testid="dataset-menu-layer-item"]';
const WAIT = { timeout: 20_000 };

const cardFor = async (name: string) => {
  const card = $(`.image-list-card*=${name}`);
  await card.waitForClickable(WAIT);
  return card;
};

// The menu stays open after an item is picked, so opening one requires
// closing whatever is already on screen.
const clickDatasetMenuItem = async (name: string, itemText: string) => {
  await browser.keys('Escape');
  await browser.waitUntil(async () => (await $$(MENU_ITEM).length) === 0, {
    ...WAIT,
    timeoutMsg: 'Expected any open dataset menu to close',
  });

  await (await cardFor(name)).$(MENU_BUTTON).click();
  // While a layer builds, the item renders a spinner instead of its label.
  const item = $(`${MENU_ITEM}*=${itemText}`);
  await item.waitForClickable(WAIT);
  await item.click();
};

// The opacity slider appears once the layer image is in the cache, and the
// dataset menus live on the Data tab, so step back after checking.
const waitForLayerBuilt = async () => {
  await volViewPage.renderingModuleTab.click();
  await browser.waitUntil(
    async () => (await volViewPage.layerOpacitySliders.length) > 0,
    { ...WAIT, timeoutMsg: 'Expected the layer to finish building' }
  );
  await $('button[data-testid="module-tab-Data"]').click();
};

describe('An image used as a layer of another image', () => {
  it('can be layered again after the layer is removed', async () => {
    // Matching grids, so building the layer reuses the source image rather
    // than resampling it.
    const parentName = writeMetaImage(`layer-parent-${Date.now()}.mha`);
    const sourceName = writeMetaImage(`layer-source-${Date.now()}.mha`, {
      step: 29,
    });
    const manifestName = `layer-source-lifetime-${Date.now()}.json`;
    await writeManifestToFile(
      {
        resources: [
          { url: `/tmp/${parentName}`, name: parentName },
          { url: `/tmp/${sourceName}`, name: sourceName },
        ],
      },
      manifestName
    );

    await openVolViewPage(manifestName);
    await (await cardFor(parentName)).click();

    await clickDatasetMenuItem(sourceName, 'Add as layer');
    await waitForLayerBuilt();
    await clickDatasetMenuItem(sourceName, 'Remove as layer');

    // Rebuilding reads the source image again, which fails once removing the
    // layer has released the image the source dataset still owns.
    await clickDatasetMenuItem(sourceName, 'Add as layer');

    await waitForLayerBuilt();
    expect(await volViewPage.getNotificationsCount()).toEqual(0);
  });
});
