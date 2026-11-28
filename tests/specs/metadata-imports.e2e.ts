import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { test, expect } from '../fixtures';

const STEM = 'metadata-imports';

test.describe('Importing beside macOS metadata and LICENSE files', () => {
  test('loads the image and skips the other files without errors', async ({
    page,
    volview,
    utils,
    scratch,
  }) => {
    const directory = utils.makeTempDir(STEM);
    const image = utils.writeMetaImage('metadata-imports-scan.mha');
    // The layout macOS Archive Utility produces for a compressed folder.
    const zip = new JSZip();
    zip.file(`scan/${image}`, readFileSync(scratch.path(image)));
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

    await volview.open(`?urls=[${urls.join(',')}]`);

    await volview.waitForViews();
    await expect(
      page.locator(`.image-list-card [title="${image}"]`)
    ).toBeVisible();
    expect(await volview.getNotificationsCount()).toBe(0);
  });

  test('explains why opening only a LICENSE file loads nothing', async ({
    volview,
    utils,
  }) => {
    const directory = utils.makeTempDir(STEM);
    const license = path.join(directory, 'LICENSE');
    writeFileSync(license, 'Terms');

    await volview.open();
    await utils.openThroughDialog(license);

    expect(await volview.getNotificationTitles()).toEqual([
      'No supported files to load',
    ]);
  });
});
