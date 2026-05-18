import * as path from 'path';
import { FIXTURES, WINDOW_SIZE } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import { openVolViewPage, writeManifestToZip } from './utils';

describe('State file manifest.json code', () => {
  it('has no errors loading version 5.0.1 manifest.json file ', async () => {
    const manifestPath = path.join(
      FIXTURES,
      'pre-multi-4up.5-0-1.volview.json'
    );
    const fileName = 'temp-session.volview.zip';
    await writeManifestToZip(manifestPath, fileName);
    await openVolViewPage(fileName);
  });

  it('loads 5.0.1 manifest with axial layer layout', async () => {
    await browser.reloadSession();
    await browser.setWindowSize(...WINDOW_SIZE);
    const manifestPath = path.join(FIXTURES, 'layer-axial.5-0-1.volview.json');
    const fileName = 'temp-layer-axial.volview.zip';
    await writeManifestToZip(manifestPath, fileName);
    await openVolViewPage(fileName);

    const renderingTab = volViewPage.renderingModuleTab;
    await renderingTab.click();

    const layerSlider = $('[data-testid="layer-opacity-slider"]');
    await layerSlider.waitForDisplayed({
      timeoutMsg: 'Layer opacity slider is not visible in the Rendering tab',
    });
  });
});
