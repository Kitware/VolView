import { volViewPage } from '../pageobjects/volview.page';
import { downloadFile, writeManifestToFile, openVolViewPage } from './utils';

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
