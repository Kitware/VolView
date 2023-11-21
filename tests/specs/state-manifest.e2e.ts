import * as path from 'path';
import * as fs from 'fs';
import { cleanuptotal } from 'wdio-cleanuptotal-service';
import JSZip from 'jszip';
import { FIXTURES, TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
// import toolsProstateJSON from '/fixtures/toolsProstate.volview.json';

describe('State file manifest.json code', () => {
  it('has no errors loading version 3.0.0 manifest.json file ', async () => {
    // write json to zip file in temp dir
    const fileName = 'asdf.zip';
    const filePath = path.join(TEMP_DIR, fileName);

    const manifest = fs.readFileSync(
      path.join(FIXTURES, 'toolsProstate.volview.json')
    );

    const zip = new JSZip();
    zip.file('manifest.json', manifest);
    const data = await zip.generateAsync({ type: 'nodebuffer' });

    await fs.promises.writeFile(filePath, data);
    cleanuptotal.addCleanup(async () => {
      fs.unlinkSync(filePath);
    });

    const urlParams = `?urls=[tmp/${fileName}]`;
    await volViewPage.open(urlParams);
    await volViewPage.waitForViews();

    const notifications = await volViewPage.getNotificationsCount();
    expect(notifications).toEqual(0);
  });
});
