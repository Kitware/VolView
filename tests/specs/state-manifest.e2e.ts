import * as path from 'path';
import * as fs from 'fs';
import { cleanuptotal } from 'wdio-cleanuptotal-service';
import JSZip from 'jszip';
import { FIXTURES, TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import { downloadFile } from './utils';

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
}

describe.skip('State file manifest.json code', () => {
  it('has no errors loading version 3.0.0 manifest.json file ', async () => {
    const manifestPath = path.join(
      FIXTURES,
      'tools-prostate.3-0-0.volview.json'
    );
    const fileName = 'temp-session.volview.zip';
    await writeManifestToZip(manifestPath, fileName);
    await openVolViewPage(fileName);
  });

  // Dev test
  // http://localhost:8080/?&urls=[http://localhost:9999/session.volview-2-1-0-labelmap-tools.zip]
  it('has no errors loading version 2.1.0 manifest.json file ', async () => {
    const FILE_NAME = 'session.volview-2-1-0-labelmap-tools.zip';

    await downloadFile(
      'https://data.kitware.com/api/v1/file/6566acb6c5a2b36857ad1786/download',
      FILE_NAME
    );

    await openVolViewPage(FILE_NAME);
  });
});
