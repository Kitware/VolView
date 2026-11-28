import * as fs from 'fs';
import * as path from 'path';

import { test, expect } from '../fixtures';
import { buildSyntheticDicom, newUid } from './syntheticDicom';
import type { Utils } from './utils';

const PUBLIC_DSC_SERIES_UID =
  '1.3.6.1.4.1.9590.100.1.2.284777661700890778225181143863199482857';
const PUBLIC_DSC_SLOPE = 112067.85375182;
const STORED_VALUES = [0, 2, 65131];
const ROWS = 4;
const COLUMNS = 4;

async function writeRescaledSeries(utils: Utils) {
  const dirName = `modality-rescale-${Date.now()}`;
  const dir = utils.makeTempDir(dirName);

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
  await utils.writeManifestToFile({ resources }, manifestName);
  return manifestName;
}

test.describe('DICOM modality rescale', () => {
  test('preserves the public DSC series Float64 output through volume loading', async ({
    volview,
    utils,
    imageCache,
  }) => {
    const manifestName = await writeRescaledSeries(utils);
    await volview.open(`?urls=[tmp/${manifestName}]`);
    await volview.waitForViews();
    const scalars = await imageCache.waitForFirstCompleteCachedImageScalars();

    expect(await volview.getNotificationsCount()).toBe(0);
    expect(scalars.type).toBe('Float64Array');
    const expected = STORED_VALUES.flatMap((stored) =>
      Array(ROWS * COLUMNS).fill(stored * PUBLIC_DSC_SLOPE)
    );
    expect(scalars.values).toEqual(expected);
  });
});
