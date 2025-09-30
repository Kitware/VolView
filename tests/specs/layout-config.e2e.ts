import * as path from 'path';
import * as fs from 'fs';
import { volViewPage } from '../pageobjects/volview.page';
import { FIXTURES, DOWNLOAD_TIMEOUT } from '../../wdio.shared.conf';
import { writeManifestToFile } from './utils';

describe('VolView Layout Configuration', () => {
  it('should load single view layout from config', async () => {
    const configPath = path.join(FIXTURES, 'config-layout-1x1.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const configFileName = 'config-layout-1x1.json';
    await writeManifestToFile(config, configFileName);

    await volViewPage.open(`?urls=[tmp/${configFileName}]`);

    await browser.pause(2000);

    await volViewPage.downloadProstateSample();

    await volViewPage.waitForViews();

    await browser.waitUntil(
      async () => {
        const currentViews = await volViewPage.views;
        const viewCount = await currentViews.length;

        if (viewCount !== 1) {
          return false;
        }

        const view = currentViews[0];
        const width = await view.getAttribute('width');
        const height = await view.getAttribute('height');

        if (!width || !height) {
          return false;
        }

        const w = parseInt(width, 10);
        const h = parseInt(height, 10);

        return w > 200 && h > 200;
      },
      {
        timeout: DOWNLOAD_TIMEOUT,
        timeoutMsg: 'Expected exactly 1 view with rendered content',
        interval: 1000,
      }
    );

    const views = await volViewPage.views;
    await expect(views).toHaveLength(1);
  });
});
