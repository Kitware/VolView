import * as path from 'path';
import * as fs from 'fs';
import { cleanuptotal } from 'wdio-cleanuptotal-service';
import JSZip from 'jszip';
import { FIXTURES, TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';

async function writeManifestToZip(manifestPath: string, fileName: string) {
  const filePath = path.join(TEMP_DIR, fileName);
  const manifest = fs.readFileSync(manifestPath);

  const zip = new JSZip();
  zip.file('manifest.json', manifest);
  const data = await zip.generateAsync({ type: 'nodebuffer' });

  await fs.promises.writeFile(filePath, data);
  cleanuptotal.addCleanup(async () => {
    fs.unlinkSync(filePath);
  });

  return filePath;
}

async function openVolViewPage(fileName: string) {
  const urlParams = `?urls=[tmp/${fileName}]`;
  await volViewPage.open(urlParams);
  await volViewPage.waitForViews();
  const notifications = await volViewPage.getNotificationsCount();
  expect(notifications).toEqual(0);

  // Check that no placeholder overlays are visible (mdi-image-off icons)
  // The overlays are in divs that are shown/hidden based on imageID
  const visibleOverlayCount = await browser.execute(() => {
    const imageOffIcons = document.querySelectorAll('i.mdi-image-off');
    return Array.from(imageOffIcons).filter((icon) => {
      const parent = icon.closest('div.overlay');
      if (!parent) return false;
      const style = window.getComputedStyle(parent);
      return style.display !== 'none' && style.visibility !== 'hidden';
    }).length;
  });

  expect(visibleOverlayCount).toEqual(0);
}

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
});
