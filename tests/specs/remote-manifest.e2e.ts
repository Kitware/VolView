import { volViewPage } from '../pageobjects/volview.page';
import { downloadFile, writeManifestToFile, openVolViewPage } from './utils';
import { ANOTHER_DICOM } from './configTestUtils';

describe('VolView loading of remoteManifest.json', () => {
  it('should show error when there is no name and URL is malformed', async () => {
    const manifest = {
      resources: [{ url: 'foo' }],
    };
    const fileName = 'remoteFilesBadUrl.json';
    await writeManifestToFile(manifest, fileName);

    const urlParams = `?urls=[tmp/${fileName}]`;
    await volViewPage.open(urlParams);

    await volViewPage.waitForNotification();
  });

  it('should load relative URI with no name property', async () => {
    await downloadFile(ANOTHER_DICOM.url, ANOTHER_DICOM.name);

    const manifest = {
      resources: [{ url: `/tmp/${ANOTHER_DICOM.name}` }],
    };
    const fileName = 'remoteFilesRelativeURI.json';
    await writeManifestToFile(manifest, fileName);
    await openVolViewPage(fileName);
    await volViewPage.waitForViews();
  });
});
