import * as fs from 'fs';
import * as path from 'path';
import { cleanuptotal } from 'wdio-cleanuptotal-service';

import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import {
  buildSlice,
  JAPANESE_NAME,
  JAPANESE_NAME_BYTES,
} from './dicomElementFixtures';
import { newUid } from './syntheticDicom';
import { writeManifestToFile } from './utils';

describe('DICOM patient name in a non-default character set', () => {
  it('decodes an ISO 2022 IR 87 name from a streamed DICOM', async () => {
    const stamp = Date.now();
    const fileName = `japanese-name-${stamp}.dcm`;
    const filePath = path.join(TEMP_DIR, fileName);
    fs.writeFileSync(
      filePath,
      buildSlice({
        studyUid: newUid(),
        seriesUid: newUid(),
        sopUid: newUid(),
        specificCharacterSet: 'ISO 2022 IR 6\\ISO 2022 IR 87',
        patientNameBytes: JAPANESE_NAME_BYTES,
      })
    );
    cleanuptotal.addCleanup(async () => fs.unlinkSync(filePath));
    const manifestName = `japanese-name-${stamp}.json`;
    await writeManifestToFile(
      { resources: [{ url: `/tmp/${fileName}`, name: fileName }] },
      manifestName
    );

    await volViewPage.open(`?urls=[tmp/${manifestName}]`);
    await volViewPage.waitForViews();

    await expect($('.patient-header-name')).toHaveText(JAPANESE_NAME);
  });
});
