import * as fs from 'fs';
import * as path from 'path';
import { cleanuptotal } from 'wdio-cleanuptotal-service';

import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import { buildSyntheticCineDicom, newUid } from './syntheticDicom';
import { waitForFirstCachedImageSpacing } from './imageCacheUtils';
import { writeManifestToFile } from './utils';

const ROW_SPACING = 1.8;
const COLUMN_SPACING = 0.45;

function writeCineDicom() {
  const fileName = `cine-pixel-spacing-${Date.now()}.dcm`;
  const filePath = path.join(TEMP_DIR, fileName);

  fs.writeFileSync(
    filePath,
    buildSyntheticCineDicom({
      studyUid: newUid(),
      seriesUid: newUid(),
      sopUid: newUid(),
      numberOfFrames: 4,
      rows: 6,
      cols: 7,
      pixelSpacing: [ROW_SPACING, COLUMN_SPACING],
    })
  );

  cleanuptotal.addCleanup(async () => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  return fileName;
}

describe('Cine DICOM PixelSpacing', () => {
  it('falls back to PixelSpacing when ultrasound regions are unusable', async () => {
    const fileName = writeCineDicom();
    const manifestName = `cine-pixel-spacing-${Date.now()}.json`;
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
      1,
    ]);
  });
});
