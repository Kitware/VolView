// A DICOM series whose instances disagree on Rows/Columns is two datasets, not
// one volume with a rejected slice: the collection planner splits on pixel
// geometry, so the scout lands in its own volume and neither volume reports an
// error.
import * as path from 'path';
import * as fs from 'fs';
import { DOWNLOAD_TIMEOUT } from '../../wdio.shared.conf';
import { volViewPage } from '../pageobjects/volview.page';
import { buildSyntheticDicom, newUid } from './syntheticDicom';
import { makeTempDir, writeManifestToFile } from './utils';

const SLICE_COUNT = 5;
const DIR_NAME = 'geometry-split';

async function writeSeries(manifestName: string) {
  const dir = makeTempDir(DIR_NAME);
  const studyUid = newUid();
  const seriesUid = newUid();
  const resources = Array.from({ length: SLICE_COUNT }, (_, i) => {
    const scout = i === 0;
    const filename = `slice-${i}.dcm`;
    fs.writeFileSync(
      path.join(dir, filename),
      buildSyntheticDicom({
        studyUid,
        seriesUid,
        sopUid: newUid(),
        instanceNumber: i + 1,
        imageOrientationPatient: [1, 0, 0, 0, 1, 0],
        imagePositionPatient: [0, 0, i],
        rows: scout ? 8 : 4,
        cols: scout ? 10 : 6,
      })
    );
    return { url: `tmp/${DIR_NAME}/${filename}`, name: filename };
  });
  await writeManifestToFile({ resources }, manifestName);
}

describe('DICOM series with instances of two pixel geometries', () => {
  it('splits the scout into its own volume and thumbnails both', async () => {
    const manifestName = `${DIR_NAME}-${Date.now()}.json`;
    await writeSeries(manifestName);
    await volViewPage.open(`?urls=[tmp/${manifestName}]`);
    await volViewPage.waitForViews();
    await volViewPage.waitForVolumeCardSliceCounts([1, 4]);

    // A thumbnail needs decoded pixels, so both volumes have loaded by then.
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
        timeout: DOWNLOAD_TIMEOUT,
        timeoutMsg:
          'expected both volume cards to render a data-URL thumbnail instead of the modality fallback',
      }
    );

    // Splitting is not a failure, so nothing is reported.
    expect(await volViewPage.getNotificationsCount()).toBe(0);
  });
});
