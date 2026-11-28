import * as path from 'path';
import { test, expect } from '../fixtures';
import { FIXTURES } from '../e2eRun';

test.describe('State file manifest.json code', () => {
  test('has no errors loading version 5.0.1 manifest.json file ', async ({
    utils,
  }) => {
    const manifestPath = path.join(
      FIXTURES,
      'pre-multi-4up.5-0-1.volview.json'
    );
    const fileName = 'temp-session.volview.zip';
    await utils.writeManifestToZip(manifestPath, fileName);
    await utils.openVolViewPage(fileName);
  });

  test('loads 5.0.1 manifest with axial layer layout', async ({
    page,
    volview,
    utils,
  }) => {
    const manifestPath = path.join(FIXTURES, 'layer-axial.5-0-1.volview.json');
    const fileName = 'temp-layer-axial.volview.zip';
    await utils.writeManifestToZip(manifestPath, fileName);
    await utils.openVolViewPage(fileName);

    const renderingTab = volview.renderingModuleTab;
    await renderingTab.click();

    const layerSlider = page.locator('[data-testid="layer-opacity-slider"]');
    await expect(
      layerSlider,
      'Layer opacity slider is not visible in the Rendering tab'
    ).toBeVisible();
  });
});
