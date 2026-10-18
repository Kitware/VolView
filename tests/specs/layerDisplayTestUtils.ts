import { volViewPage } from '../pageobjects/volview.page';
import { waitForModuleTransitions } from './utils';

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

export async function openLayerDisplayControls() {
  await volViewPage.renderingModuleTab.click();
  const volume = $('[data-testid="volume-rendering-toggle"]');
  if (
    (await volume.isExisting()) &&
    (await volume.getAttribute('aria-expanded')) === 'true'
  )
    await volume.click();
  await waitForModuleTransitions();
  await $('[data-testid="layer-colormap"]').waitForDisplayed();
  await browser.waitUntil(
    async () => (await $$('.Vue-Toastification__toast').length) === 0
  );
}
