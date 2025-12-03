import { volViewPage } from '../pageobjects/volview.page';
import { MINIMAL_DICOM } from './configTestUtils';
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

  it.skip('should load relative URI with no name property', async () => {
    await downloadFile(MINIMAL_DICOM.url, MINIMAL_DICOM.name);

    const manifest = {
      resources: [{ url: `/tmp/${MINIMAL_DICOM.name}` }],
    };
    const fileName = 'remoteFilesRelativeURI.json';
    await writeManifestToFile(manifest, fileName);
    await openVolViewPage(fileName);
  });
});
