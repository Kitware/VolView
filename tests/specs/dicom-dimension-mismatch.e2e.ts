// A DICOM series whose instances disagree on Rows/Columns is two datasets, not
// one volume with a rejected slice: the collection planner splits on pixel
// geometry, so the scout lands in its own volume and neither volume reports an
// error.
import * as path from 'path';
import * as fs from 'fs';
import { test, expect } from '../fixtures';
import { buildSyntheticDicom, newUid } from './syntheticDicom';
import type { Utils } from './utils';

const SLICE_COUNT = 5;
const DIR_NAME = 'geometry-split';

async function writeSeries(utils: Utils, manifestName: string) {
  const dir = utils.makeTempDir(DIR_NAME);
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
  await utils.writeManifestToFile({ resources }, manifestName);
}

test.describe('DICOM series with instances of two pixel geometries', () => {
  test('splits the scout into its own volume and thumbnails both', async ({
    page,
    volview,
    utils,
  }) => {
    const manifestName = `${DIR_NAME}-${Date.now()}.json`;
    await writeSeries(utils, manifestName);
    await volview.open(`?urls=[tmp/${manifestName}]`);
    await volview.waitForViews();
    await volview.waitForVolumeCardSliceCounts([1, 4]);

    // A thumbnail needs decoded pixels, so both volumes have loaded by then.
    const thumbnails = page.locator('.volume-card img.v-img__img');
    await expect
      .poll(
        async () => {
          const sources = await thumbnails.evaluateAll((images) =>
            images.map((image) => image.getAttribute('src'))
          );
          return (
            sources.length === 2 &&
            sources.every((src) => !!src && src.startsWith('data:image/'))
          );
        },
        {
          message:
            'expected both volume cards to render a data-URL thumbnail instead of the modality fallback',
        }
      )
      .toBe(true);

    // Splitting is not a failure, so nothing is reported.
    expect(await volview.getNotificationsCount()).toBe(0);
  });
});
