// A DICOM series whose instances disagree on Rows/Columns is two datasets, not
// one volume with a rejected slice: the collection planner splits on pixel
// geometry, so the scout lands in its own volume whether it arrives first or
// last, and neither volume reports an error.
import * as path from 'path';
import * as fs from 'fs';
import { volViewPage } from '../pageobjects/volview.page';
import { buildSyntheticDicom, newUid } from './syntheticDicom';
import { makeTempDir, writeManifestToFile } from './utils';

const IMAGE_ORIENTATION_PATIENT = [1, 0, 0, 0, 1, 0] as const;
const SLICE_COUNT = 5;

const SERIES_ROWS = 4;
const SERIES_COLS = 6;
const SCOUT_ROWS = 8;
const SCOUT_COLS = 10;

async function writeSeries(
  dirName: string,
  scoutSlice: number,
  manifestName: string
) {
  const dir = makeTempDir(dirName);

  const studyUid = newUid();
  const seriesUid = newUid();
  const resources = [];

  for (let i = 0; i < SLICE_COUNT; i++) {
    const scout = i === scoutSlice;
    const filename = `slice-${i}.dcm`;
    fs.writeFileSync(
      path.join(dir, filename),
      buildSyntheticDicom({
        studyUid,
        seriesUid,
        sopUid: newUid(),
        instanceNumber: i + 1,
        imageOrientationPatient: IMAGE_ORIENTATION_PATIENT,
        imagePositionPatient: [0, 0, i],
        rows: scout ? SCOUT_ROWS : SERIES_ROWS,
        cols: scout ? SCOUT_COLS : SERIES_COLS,
      })
    );
    resources.push({ url: `tmp/${dirName}/${filename}`, name: filename });
  }

  await writeManifestToFile({ resources }, manifestName);
}

async function waitForVolumeCards(count: number) {
  await browser.waitUntil(
    async () => (await $$('.volume-card').length) === count,
    {
      timeout: 30000,
      timeoutMsg: `expected exactly ${count} volume cards`,
    }
  );
}

async function loadSplitSeries(dirName: string, scoutSlice: number) {
  const manifestName = `${dirName}-${Date.now()}.json`;
  await writeSeries(dirName, scoutSlice, manifestName);
  await volViewPage.open(`?urls=[tmp/${manifestName}]`);
  await volViewPage.waitForViews();
  await waitForVolumeCards(2);
}

describe('DICOM series with instances of two pixel geometries', () => {
  it('splits the scout out when it arrives first', async () => {
    await loadSplitSeries('geometry-split-first', 0);

    await volViewPage.waitForVolumeCardSliceCounts([1, 4]);

    // Splitting is not a failure, so nothing is reported.
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('splits the scout out when it arrives last', async () => {
    await loadSplitSeries('geometry-split-last', SLICE_COUNT - 1);

    await volViewPage.waitForVolumeCardSliceCounts([1, 4]);

    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });

  it('thumbnails both volumes from their own slices', async () => {
    await loadSplitSeries('geometry-split-thumbnails', 0);

    await browser.waitUntil(
      async () => {
        const sources = await $$('.volume-card img.v-img__img').map(
          (thumbnail) => thumbnail.getAttribute('src')
        );
        return (
          sources.length === 2 &&
          sources.every((src) => !!src && src.startsWith('data:image/'))
        );
      },
      {
        timeout: 30000,
        timeoutMsg:
          'expected both volume cards to render a data-URL thumbnail instead of the modality fallback',
      }
    );
  });
});
