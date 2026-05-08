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
import { volViewPage } from '../pageobjects/volview.page';
import { TEMP_DIR } from '../../wdio.shared.conf';
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

function writeSeries(label: 'A' | 'B', dirName: string, manifestName: string) {
  const seriesUid = newUid();
  const dir = path.join(TEMP_DIR, dirName);
  fs.mkdirSync(dir, { recursive: true });

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

  fs.writeFileSync(
    path.join(TEMP_DIR, manifestName),
    JSON.stringify({ resources })
  );
}

describe('Multi-series load: two series with identical ImageOrientationPatient', () => {
  before(() => {
    writeSeries('A', 'multi-series-A', 'multi-series-A.json');
    writeSeries('B', 'multi-series-B', 'multi-series-B.json');
  });

  it('keeps the two series separate (two volume cards)', async () => {
    await volViewPage.open(
      '?urls=[tmp/multi-series-A.json,tmp/multi-series-B.json]'
    );
    await volViewPage.waitForViews();
    await browser.waitUntil(
      async () => (await $$('.volume-card').length) === 2,
      { timeout: 30000, timeoutMsg: 'expected exactly two volume cards' }
    );
  });
});
