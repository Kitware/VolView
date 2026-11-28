import { test, expect } from '../fixtures';
import {
  buildSlice,
  JAPANESE_CHARACTER_SET,
  JAPANESE_NAME,
  JAPANESE_NAME_BYTES,
} from './dicomElementFixtures';
import { newUid } from './syntheticDicom';

test.describe('DICOM patient name in a non-default character set', () => {
  test('decodes an ISO 2022 IR 87 name from a streamed DICOM', async ({
    page,
    scratch,
    volview,
    utils,
  }) => {
    const stamp = Date.now();
    const fileName = `japanese-name-${stamp}.dcm`;
    scratch.writeFile(
      fileName,
      buildSlice({
        studyUid: newUid(),
        seriesUid: newUid(),
        sopUid: newUid(),
        specificCharacterSet: JAPANESE_CHARACTER_SET,
        patientNameBytes: JAPANESE_NAME_BYTES,
      })
    );
    const manifestName = `japanese-name-${stamp}.json`;
    await utils.writeManifestToFile(
      { resources: [{ url: `/tmp/${fileName}`, name: fileName }] },
      manifestName
    );

    await volview.open(`?urls=[tmp/${manifestName}]`);
    await volview.waitForViews();

    await expect(page.locator('.patient-header-name')).toHaveText(
      JAPANESE_NAME
    );
  });
});
