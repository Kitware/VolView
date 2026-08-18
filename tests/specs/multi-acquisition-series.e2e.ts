// One DICOM series carrying several overlapping acquisitions must load as one
// volume per acquisition, not as a single stack of interleaved slices.
//
// GDCM's series-detail key covers SeriesNumber, SliceThickness, Rows and
// Columns but not AcquisitionNumber, so the categorize pipeline hands back all
// of these slices as one volume. Sorted by position they no longer sit on any
// single lattice, and the derived Z spacing describes none of the scans.
//
// Modelled on IDC series
// 1.3.6.1.4.1.14519.5.2.1.3098.5025.295130953269492004748715270821, which
// holds three 2.5mm chest/abdomen passes offset from each other by fractions
// of a slice. Synthetic DICOMs are generated on the fly so the test carries
// no binary fixtures.
import * as path from 'path';
import * as fs from 'fs';
import { volViewPage } from '../pageobjects/volview.page';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { writeManifestToFile } from './utils';
import { buildSyntheticDicom, newUid } from './syntheticDicom';

const SLICE_SPACING = 2.5;

// Each pass is uniform on its own; the sub-slice offsets are what make the
// merged stack irregular. Slice counts differ so each volume card is
// identifiable by its label alone.
const ACQUISITIONS = [
  { number: 1, firstSliceZ: 0, sliceCount: 5 },
  { number: 2, firstSliceZ: 0.75, sliceCount: 6 },
  { number: 3, firstSliceZ: 1.75, sliceCount: 4 },
];

const DIR_NAME = 'multi-acquisition-series';
const MANIFEST_NAME = 'multi-acquisition-series.json';

async function writeSeries() {
  const studyUid = newUid();
  const seriesUid = newUid();
  const dir = path.join(TEMP_DIR, DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });

  let instanceNumber = 0;
  const resources = ACQUISITIONS.flatMap(
    ({ number, firstSliceZ, sliceCount }) =>
      Array.from({ length: sliceCount }, (_, i) => {
        instanceNumber += 1;
        const filename = `acq${number}-slice${i}.dcm`;
        fs.writeFileSync(
          path.join(dir, filename),
          buildSyntheticDicom({
            studyUid,
            seriesUid,
            sopUid: newUid(),
            instanceNumber,
            acquisitionNumber: number,
            imageOrientationPatient: [1, 0, 0, 0, 1, 0],
            imagePositionPatient: [0, 0, firstSliceZ + i * SLICE_SPACING],
            sliceThickness: SLICE_SPACING,
          })
        );
        return { url: `tmp/${DIR_NAME}/${filename}`, name: filename };
      })
  );

  await writeManifestToFile({ resources }, MANIFEST_NAME);
}

// The card label carries the slice count as "[N]".
async function getVolumeCardSliceCounts() {
  const cards = [...(await $$('.volume-card'))];
  const labels = await Promise.all(cards.map((card) => card.getText()));
  return labels
    .map((label) => Number(label.match(/\[(\d+)\]/)?.[1]))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

describe('Multi-acquisition series: one series holding three overlapping scans', () => {
  before(async () => {
    await writeSeries();
  });

  it('loads one volume per acquisition instead of one interleaved stack', async () => {
    await volViewPage.open(`?urls=[tmp/${MANIFEST_NAME}]`);
    await volViewPage.waitForViews();

    const expected = ACQUISITIONS.map((a) => a.sliceCount).sort(
      (a, b) => a - b
    );

    await browser.waitUntil(
      async () => (await getVolumeCardSliceCounts()).length === expected.length,
      {
        timeout: 30000,
        timeoutMsg: `expected ${expected.length} labelled volume cards`,
      }
    );

    // One card per acquisition, each holding only that acquisition's slices.
    expect(await getVolumeCardSliceCounts()).toEqual(expected);
  });
});
