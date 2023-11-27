import * as path from 'path';
import * as fs from 'fs';
import { cleanuptotal } from 'wdio-cleanuptotal-service';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import { downloadFile } from './utils';

async function writeManifestToFile(manifest: any, fileName: string) {
  const filePath = path.join(TEMP_DIR, fileName);
  await fs.promises.writeFile(filePath, JSON.stringify(manifest));
  cleanuptotal.addCleanup(async () => {
    fs.unlinkSync(filePath);
  });
  return filePath;
}

async function openVolViewPage(fileName: string) {
  const urlParams = `?urls=[tmp/${fileName}]`;
  await volViewPage.open(urlParams);
}

describe('VolView loading of remoteManifest.json', () => {
  it('should show error when there is no name and URL is malformed', async () => {
    const manifest = {
      resources: [{ url: 'foo' }],
    };
    const fileName = 'remoteFilesBadUrl.json';
    await writeManifestToFile(manifest, fileName);
    await openVolViewPage(fileName);

    await volViewPage.waitForNotification();
  });

  it('should load relative URI with no name property', async () => {
    const dicom = '1-001.dcm';
    await downloadFile(
      'https://data.kitware.com/api/v1/file/655d42a694ef39bf0a4a8bb3/download',
      dicom
    );

    const manifest = {
      resources: [{ url: `/tmp/${dicom}` }],
    };
    const fileName = 'remoteFilesRelativeURI.json';
    await writeManifestToFile(manifest, fileName);
    await openVolViewPage(fileName);
    await volViewPage.waitForViews();
  });
});
