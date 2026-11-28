import { test } from '../fixtures';
import { MINIMAL_DICOM } from '../datasets';

test.describe('VolView loading of remoteManifest.json', () => {
  test('should show error when there is no name and URL is malformed', async ({
    volview,
    utils,
  }) => {
    const manifest = {
      resources: [{ url: 'foo' }],
    };
    const fileName = 'remoteFilesBadUrl.json';
    await utils.writeManifestToFile(manifest, fileName);

    const urlParams = `?urls=[tmp/${fileName}]`;
    await volview.open(urlParams);

    await volview.waitForNotification();
  });

  test('should load relative URI with no name property', async ({ utils }) => {
    const manifest = {
      resources: [{ url: `/tmp/${MINIMAL_DICOM.name}` }],
    };
    const fileName = 'remoteFilesRelativeURI.json';
    await utils.writeManifestToFile(manifest, fileName);
    await utils.openVolViewPage(fileName);
  });
});
