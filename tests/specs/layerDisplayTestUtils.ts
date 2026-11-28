import { expect, type Page } from '@playwright/test';
import {
  containsText,
  createVolViewPage,
  waitForTransitions,
} from '../pageobjects/volview.page';
import type { Scratch } from '../scratch';
import { createUtils } from './utils';

export const layeredImageManifest = (base: string, overlay: string) => ({
  version: '7.0.0',
  dataSources: [base, overlay].map((name, index) => ({
    id: index + 1,
    type: 'uri',
    uri: `/tmp/${name}`,
    name: name.split('/').at(-1),
  })),
  datasets: [
    { id: 'base', dataSourceId: 1 },
    { id: 'overlay', dataSourceId: 2 },
  ],
  primarySelection: 'base',
  parentToLayers: [{ selectionKey: 'base', sourceSelectionKeys: ['overlay'] }],
});

export const createLayerDisplayUtils = (page: Page, scratch: Scratch) => {
  const volview = createVolViewPage(page, scratch);
  const utils = createUtils(page, scratch);

  const openLayerDisplayControls = async () => {
    await volview.renderingModuleTab.click();
    const volume = page.locator('[data-testid="volume-rendering-toggle"]');
    if (
      (await volume.count()) > 0 &&
      (await volume.getAttribute('aria-expanded')) === 'true'
    )
      await volume.click();
    await utils.waitForModuleTransitions();
    await expect(page.locator('[data-testid="layer-colormap"]')).toBeVisible();
    await expect(page.locator('.Vue-Toastification__toast')).toHaveCount(0);
  };

  const selectBasePalette = async (title: string) => {
    const palette = page.locator('[data-testid="base-image-colormap"]');
    await palette.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await expect(palette).toBeVisible();
    await waitForTransitions(palette);
    await palette.click();
    const menu = page.locator('.v-menu.v-overlay--active .v-overlay__content');
    await expect(menu).toBeVisible();
    await waitForTransitions(menu);
    const option = page
      .locator('[role="option"]', { hasText: containsText(title) })
      .first();
    await option.evaluate((element) =>
      element.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    );
    await expect(option).toBeVisible();
    await waitForTransitions(option);
    // The menu loses its active class on close, so follow the option out.
    const item = await option.elementHandle();
    await option.click();
    await item?.waitForElementState('hidden');
    await expect(palette).toContainText(title);
  };

  return { openLayerDisplayControls, selectBasePalette };
};

export type LayerDisplayUtils = ReturnType<typeof createLayerDisplayUtils>;
