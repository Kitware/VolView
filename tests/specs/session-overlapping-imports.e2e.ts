// A session saved after an incremental import must restore what the browser
// shows, not the membership the first import saw.
//
// One series holds two overlapping acquisitions. The first import loads one of
// them; a second import brings the other, and the planner regroups the series
// into two volumes. The session saved afterwards must restore both. Deleting
// one volume and saving again must restore only the survivor: a dataset the
// user removed cannot come back.
import * as path from 'path';
import { test } from '../fixtures';
import type { VolViewPage } from '../pageobjects/volview.page';
import { newUid } from './syntheticDicom';

// Offset by half a slice, so the two passes overlap and the planner separates
// them. Slice counts differ so each volume card is identifiable by its label.
const FIRST_PASS = { number: 1, firstSliceZ: 0, sliceCount: 5 };
const SECOND_PASS = { number: 2, firstSliceZ: 1.25, sliceCount: 6 };

const DIR_NAME = 'session-overlapping-imports';
const MANIFEST_NAME = 'session-overlapping-imports.json';

const openSavedSession = async (volview: VolViewPage, fileName: string) => {
  await volview.open(`?urls=[tmp/${fileName}]`);
  await volview.waitForViews();
};

test.describe('Session saved after an incremental import of one series', () => {
  let secondPassFiles: string[];

  test.beforeEach(async ({ scratch, utils }) => {
    const uids = { studyUid: newUid(), seriesUid: newUid() };
    const resources = utils.writeAcquisitions(DIR_NAME, uids, [FIRST_PASS]);
    secondPassFiles = utils
      .writeAcquisitions(DIR_NAME, uids, [SECOND_PASS])
      .map(({ name }) => scratch.path(path.join(DIR_NAME, name)));
    await utils.writeManifestToFile({ resources }, MANIFEST_NAME);
  });

  test('restores both volumes, and drops one the user deleted', async ({
    volview,
    utils,
  }) => {
    await volview.open(`?urls=[tmp/${MANIFEST_NAME}]`);
    await volview.waitForViews();
    await volview.waitForVolumeCardSliceCounts([FIRST_PASS.sliceCount]);

    // The regroup this triggers replaces the volume the first import earned.
    await utils.dropFiles(secondPassFiles);
    const bothPasses = [FIRST_PASS.sliceCount, SECOND_PASS.sliceCount];
    await volview.waitForVolumeCardSliceCounts(bothPasses);

    const withBoth = await volview.saveSession();
    await openSavedSession(volview, withBoth);
    await volview.waitForVolumeCardSliceCounts(bothPasses);

    await volview.deleteVolumeCard(FIRST_PASS.sliceCount);
    const survivor = [SECOND_PASS.sliceCount];
    await volview.waitForVolumeCardSliceCounts(survivor);

    const withSurvivor = await volview.saveSession();
    await openSavedSession(volview, withSurvivor);
    await volview.waitForVolumeCardSliceCounts(survivor);
  });
});
