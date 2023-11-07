import * as path from 'path';
import * as fs from 'fs';
import { cleanuptotal } from 'wdio-cleanuptotal-service';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';

describe('VolView loading of remoteManifest.json', () => {
  it('should show error when there is no name and URL is malformed', async () => {
    const manifest = {
      resources: [{ url: 'foo' }],
    };
    // write object as json to file
    const fileName = 'remoteFilesBadUrl.json';
    const filePath = path.join(TEMP_DIR, fileName);
    await fs.promises.writeFile(filePath, JSON.stringify(manifest));
    cleanuptotal.addCleanup(async () => {
      fs.unlinkSync(filePath);
    });

    const urlParams = `?urls=[tmp/${fileName}]`;
    await volViewPage.open(urlParams);
    await volViewPage.waitForNotification();
  });
});
