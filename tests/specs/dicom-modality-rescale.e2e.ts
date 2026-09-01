import * as fs from 'fs';
import * as path from 'path';
import { cleanuptotal } from 'wdio-cleanuptotal-service';

import { TEMP_DIR } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import { buildSyntheticDicom, newUid } from './syntheticDicom';
import { waitForFirstCompleteCachedImageScalars } from './imageCacheUtils';
import { writeManifestToFile } from './utils';

const PUBLIC_DSC_SERIES_UID =
  '1.3.6.1.4.1.9590.100.1.2.284777661700890778225181143863199482857';
const PUBLIC_DSC_SLOPE = 112067.85375182;
const STORED_VALUES = [0, 2, 65131];
const ROWS = 4;
const COLUMNS = 4;

async function writeRescaledSeries() {
  const dirName = `modality-rescale-${Date.now()}`;
  const dir = path.join(TEMP_DIR, dirName);
  fs.mkdirSync(dir, { recursive: true });
  cleanuptotal.addCleanup(async () => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const studyUid = newUid();
  const resources = STORED_VALUES.map((pixelValue, index) => {
    const filename = `slice-${index}.dcm`;
    fs.writeFileSync(
      path.join(dir, filename),
      buildSyntheticDicom({
        studyUid,
        seriesUid: PUBLIC_DSC_SERIES_UID,
        sopUid: newUid(),
        instanceNumber: index + 1,
        imageOrientationPatient: [1, 0, 0, 0, 1, 0],
        imagePositionPatient: [0, 0, index],
        rows: ROWS,
        cols: COLUMNS,
        bitsAllocated: 16,
        bitsStored: 16,
        highBit: 15,
        pixelRepresentation: 0,
        rescaleSlope: PUBLIC_DSC_SLOPE,
        rescaleIntercept: 0,
        pixelValue,
      })
    );
    return { url: `tmp/${dirName}/${filename}`, name: filename };
  });

  const manifestName = `modality-rescale-${Date.now()}.json`;
  await writeManifestToFile({ resources }, manifestName);
  return manifestName;
}

describe('DICOM modality rescale', () => {
  it('preserves the public DSC series Float64 output through volume loading', async () => {
    const manifestName = await writeRescaledSeries();
    await volViewPage.open(`?urls=[tmp/${manifestName}]`);
    await volViewPage.waitForViews();
    const scalars = await waitForFirstCompleteCachedImageScalars();

    expect(await volViewPage.getNotificationsCount()).toBe(0);
    expect(scalars.type).toBe('Float64Array');
    const expected = STORED_VALUES.flatMap((stored) =>
      Array(ROWS * COLUMNS).fill(stored * PUBLIC_DSC_SLOPE)
    );
    expect(scalars.values).toEqual(expected);
  });
});
