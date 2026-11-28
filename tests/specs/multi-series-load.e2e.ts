// Regression for https://github.com/Kitware/VolView/issues/861
//
// Two DICOM series with distinct SeriesInstanceUIDs but identical
// ImageOrientationPatient must remain two volume cards, not collapse
// into one merged scan.
//
// Synthetic DICOMs are generated on the fly so the test has no external
// dependencies.
import * as path from 'path';
import * as fs from 'fs';
import { test, expect } from '../fixtures';
import type { Utils } from './utils';
import { buildSyntheticDicom, newUid } from './syntheticDicom';

// Oblique ImageOrientationPatient — same value for both series. With
// this orientation the pre-fix areCosinesAlmostEqual sees a non-zero
// second window and the cross-volume cosinesToID leak collapses both
// series into one.
const SHARED_IMAGE_ORIENTATION_PATIENT = [
  -0.00964, 0.99248, 0.12202, 0.06932, 0.12239, -0.99006,
] as const;

const SLICE_COUNT = 5;
const STUDY_UID = newUid();

function writeSeries(
  utils: Utils,
  label: 'A' | 'B',
  dirName: string,
  manifestName: string
) {
  const seriesUid = newUid();
  const dir = utils.makeTempDir(dirName);

  const resources: { url: string; name: string }[] = [];
  for (let i = 0; i < SLICE_COUNT; i++) {
    const filename = `slice-${i}.dcm`;
    const bytes = buildSyntheticDicom({
      studyUid: STUDY_UID,
      seriesUid,
      sopUid: newUid(),
      instanceNumber: i + 1,
      imageOrientationPatient: SHARED_IMAGE_ORIENTATION_PATIENT,
      // Step along the slice-normal so GDCM can sort within the series.
      imagePositionPatient: [0, 0, i],
    });
    fs.writeFileSync(path.join(dir, filename), bytes);
    resources.push({ url: `tmp/${dirName}/${filename}`, name: filename });
  }

  return utils.writeManifestToFile({ resources }, manifestName);
}

test.describe('Multi-series load: two series with identical ImageOrientationPatient', () => {
  test.beforeEach(async ({ utils }) => {
    await writeSeries(utils, 'A', 'multi-series-A', 'multi-series-A.json');
    await writeSeries(utils, 'B', 'multi-series-B', 'multi-series-B.json');
  });

  test('keeps the two series separate (two volume cards)', async ({
    page,
    volview,
  }) => {
    await volview.open(
      '?urls=[tmp/multi-series-A.json,tmp/multi-series-B.json]'
    );
    await volview.waitForViews();
    await expect(
      page.locator('.volume-card'),
      'expected exactly two volume cards'
    ).toHaveCount(2);
  });
});
