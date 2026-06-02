import * as fs from 'fs';
import * as path from 'path';
import { cleanuptotal } from 'wdio-cleanuptotal-service';

import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import { buildSyntheticDicom, newUid } from './syntheticDicom';
import { waitForFirstCachedImageSpacing } from './imageCacheUtils';
import { writeManifestToFile } from './utils';

const ROW_SPACING = 2.5;
const COLUMN_SPACING = 0.75;
const SPACING_BETWEEN_SLICES = 7.25;

function writeSingleSliceDicom() {
  const fileName = `single-slice-spacing-${Date.now()}.dcm`;
  const filePath = path.join(TEMP_DIR, fileName);
  const studyUid = newUid();
  const seriesUid = newUid();

  fs.writeFileSync(
    filePath,
    buildSyntheticDicom({
      studyUid,
      seriesUid,
      sopUid: newUid(),
      instanceNumber: 1,
      imageOrientationPatient: [1, 0, 0, 0, 1, 0],
      imagePositionPatient: [0, 0, 0],
      rows: 5,
      cols: 6,
      pixelSpacing: [ROW_SPACING, COLUMN_SPACING],
      spacingBetweenSlices: SPACING_BETWEEN_SLICES,
      sliceThickness: 19,
    })
  );

  cleanuptotal.addCleanup(async () => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  return fileName;
}

describe('DICOM image spacing', () => {
  it('matches ITK spacing for single-slice images with SpacingBetweenSlices', async () => {
    const fileName = writeSingleSliceDicom();
    const manifestName = `single-slice-spacing-${Date.now()}.json`;
    await writeManifestToFile(
      {
        resources: [{ url: `/tmp/${fileName}`, name: fileName }],
      },
      manifestName
    );

    await volViewPage.open(`?urls=[tmp/${manifestName}]`);

    expect(await waitForFirstCachedImageSpacing()).toEqual([
      COLUMN_SPACING,
      ROW_SPACING,
      SPACING_BETWEEN_SLICES,
    ]);
  });
});
