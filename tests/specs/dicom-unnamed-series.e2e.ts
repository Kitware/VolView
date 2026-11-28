import * as path from 'path';
import * as fs from 'fs';
import { test, expect } from '../fixtures';
import { buildSyntheticDicom, newUid } from './syntheticDicom';

const DIR_NAME = 'dicom-unnamed-series';
const MANIFEST = 'dicom-unnamed-series.json';
const SERIES_UID = newUid();

test.describe('DICOM series without SeriesDescription or SeriesNumber', () => {
  test.beforeEach(({ utils }) => {
    const dir = utils.makeTempDir(DIR_NAME);
    const studyUid = newUid();
    const resources = [0, 1, 2].map((i) => {
      const filename = `slice-${i}.dcm`;
      const bytes = buildSyntheticDicom({
        studyUid,
        seriesUid: SERIES_UID,
        sopUid: newUid(),
        instanceNumber: i + 1,
        imageOrientationPatient: [1, 0, 0, 0, 1, 0],
        imagePositionPatient: [0, 0, i],
      });
      fs.writeFileSync(path.join(dir, filename), bytes);
      return { url: `tmp/${DIR_NAME}/${filename}`, name: filename };
    });
    return utils.writeManifestToFile({ resources }, MANIFEST);
  });

  test('names the volume card by its SeriesInstanceUID', async ({
    page,
    volview,
  }) => {
    await volview.open(`?urls=[tmp/${MANIFEST}]`);
    await volview.waitForViews();
    await expect(
      page.locator('.volume-card .series-desc'),
      'expected one volume card named by its SeriesInstanceUID'
    ).toHaveText([SERIES_UID]);
  });
});
