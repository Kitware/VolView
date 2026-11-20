// A session saved after an incremental import must restore what the browser
// shows, not the membership the first import saw.
//
// One series holds two overlapping acquisitions. The first import loads one of
// them; a second import brings the other, and the planner regroups the series
// into two volumes. The session saved afterwards must restore both. Deleting
// one volume and saving again must restore only the survivor: a dataset the
// user removed cannot come back.
import * as path from 'path';
import { volViewPage } from '../pageobjects/volview.page';
import { TEMP_DIR } from '../../wdio.shared.conf';
import {
  SESSION_SAVE_TIMEOUT,
  dropFiles,
  waitForFileExists,
  writeAcquisitions,
  writeManifestToFile,
} from './utils';
import { newUid } from './syntheticDicom';

// Offset by half a slice, so the two passes overlap and the planner separates
// them. Slice counts differ so each volume card is identifiable by its label.
const FIRST_PASS = { number: 1, firstSliceZ: 0, sliceCount: 5 };
const SECOND_PASS = { number: 2, firstSliceZ: 1.25, sliceCount: 6 };

const DIR_NAME = 'session-overlapping-imports';
const MANIFEST_NAME = 'session-overlapping-imports.json';

const saveSession = async () => {
  const fileName = await volViewPage.saveSession();
  await waitForFileExists(path.join(TEMP_DIR, fileName), SESSION_SAVE_TIMEOUT);
  return fileName;
};

const openSavedSession = async (fileName: string) => {
  await volViewPage.open(`?urls=[tmp/${fileName}]`);
  await volViewPage.waitForViews();
};

describe('Session saved after an incremental import of one series', () => {
  let secondPassFiles: string[];

  before(async () => {
    const uids = { studyUid: newUid(), seriesUid: newUid() };
    const resources = writeAcquisitions(DIR_NAME, uids, [FIRST_PASS]);
    secondPassFiles = writeAcquisitions(DIR_NAME, uids, [SECOND_PASS]).map(
      ({ name }) => path.join(TEMP_DIR, DIR_NAME, name)
    );
    await writeManifestToFile({ resources }, MANIFEST_NAME);
  });

  it('restores both volumes, and drops one the user deleted', async () => {
    await volViewPage.open(`?urls=[tmp/${MANIFEST_NAME}]`);
    await volViewPage.waitForViews();
    await volViewPage.waitForVolumeCardSliceCounts([FIRST_PASS.sliceCount]);

    // The regroup this triggers replaces the volume the first import earned.
    await dropFiles(secondPassFiles);
    const bothPasses = [FIRST_PASS.sliceCount, SECOND_PASS.sliceCount];
    await volViewPage.waitForVolumeCardSliceCounts(bothPasses);

    const withBoth = await saveSession();
    await openSavedSession(withBoth);
    await volViewPage.waitForVolumeCardSliceCounts(bothPasses);

    await volViewPage.deleteVolumeCard(FIRST_PASS.sliceCount);
    const survivor = [SECOND_PASS.sliceCount];
    await volViewPage.waitForVolumeCardSliceCounts(survivor);

    const withSurvivor = await saveSession();
    await openSavedSession(withSurvivor);
    await volViewPage.waitForVolumeCardSliceCounts(survivor);
  });
});
