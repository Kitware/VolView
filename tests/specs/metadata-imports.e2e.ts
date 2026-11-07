import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import { makeTempDir, openThroughDialog, writeMetaImage } from './utils';

const STEM = 'metadata-imports';

const notificationTitles = async () => {
  await volViewPage.notifications.click();
  const titles = $$('.message-center .v-expansion-panel-title .header > span');
  await titles[0].waitForDisplayed();
  return titles.map((title) => title.getText());
};

describe('Importing beside macOS metadata and LICENSE files', () => {
  it('loads the image and skips the other files without errors', async () => {
    const directory = makeTempDir(STEM);
    const image = writeMetaImage('metadata-imports-scan.mha');
    // The layout macOS Archive Utility produces for a compressed folder.
    const zip = new JSZip();
    zip.file(`scan/${image}`, readFileSync(path.join(TEMP_DIR, image)));
    zip.file('scan/.DS_Store', 'Finder metadata');
    zip.file('scan/LICENSE', 'Terms');
    zip.file('__MACOSX/._scan', 'AppleDouble');
    zip.file(`__MACOSX/scan/._${image}`, 'AppleDouble');
    writeFileSync(
      path.join(directory, 'scan.zip'),
      await zip.generateAsync({ type: 'nodebuffer' })
    );
    writeFileSync(path.join(directory, '.DS_Store'), 'Finder metadata');
    writeFileSync(path.join(directory, `._${image}`), 'AppleDouble');
    const urls = ['scan.zip', '.DS_Store', `._${image}`].map(
      (name) => `tmp/${STEM}/${name}`
    );

    await volViewPage.open(`?urls=[${urls.join(',')}]`);

    await volViewPage.waitForViews();
    await expect($(`.image-list-card [title="${image}"]`)).toBeDisplayed();
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('explains why opening only a LICENSE file loads nothing', async () => {
    const directory = makeTempDir(STEM);
    const license = path.join(directory, 'LICENSE');
    writeFileSync(license, 'Terms');

    await volViewPage.open();
    await openThroughDialog(license);

    expect(await notificationTitles()).toEqual(['No supported files to load']);
  });
});
