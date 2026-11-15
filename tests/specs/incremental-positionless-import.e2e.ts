// One series carrying several overlapping acquisitions loads as one volume
// per acquisition, and a second import must not dissolve those volumes.
//
// Modelled on IDC series
// 1.3.6.1.4.1.14519.5.2.1.3098.5025.295130953269492004748715270821, which
// holds three 2.5mm chest/abdomen passes offset from each other by fractions
// of a slice. A later import brings one more slice of that series whose
// ImagePositionPatient is empty, so nothing can be said about where it sits.
// Every volume must survive, the unplaceable slice must arrive as a volume of
// its own, and the user must be told about it.
import * as path from 'path';
import * as fs from 'fs';
import { volViewPage } from '../pageobjects/volview.page';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { dropFiles, writeAcquisitions, writeManifestToFile } from './utils';
import { buildSyntheticDicom, newUid } from './syntheticDicom';

// Each pass is uniform on its own; the sub-slice offsets are what make the
// merged stack irregular. Slice counts differ so each volume card is
// identifiable by its label alone.
const ACQUISITIONS = [
  { number: 1, firstSliceZ: 0, sliceCount: 5 },
  { number: 2, firstSliceZ: 0.75, sliceCount: 6 },
  { number: 3, firstSliceZ: 1.75, sliceCount: 4 },
];

const DIR_NAME = 'incremental-positionless-import';
const MANIFEST_NAME = 'incremental-positionless-import.json';
const POSITIONLESS = path.join(TEMP_DIR, DIR_NAME, 'positionless.dcm');

describe('Incremental import of a slice with no readable position', () => {
  before(async () => {
    const uids = { studyUid: newUid(), seriesUid: newUid() };
    const resources = writeAcquisitions(DIR_NAME, uids, ACQUISITIONS);
    // Same series and same hard facts as the passes, so only its unreadable
    // geometry can keep it out of them.
    fs.writeFileSync(
      POSITIONLESS,
      buildSyntheticDicom({
        ...uids,
        sopUid: newUid(),
        instanceNumber: 99,
        imageOrientationPatient: [1, 0, 0, 0, 1, 0],
        imagePositionPatient: null,
        sliceThickness: 2.5,
      })
    );
    await writeManifestToFile({ resources }, MANIFEST_NAME);
  });

  it('keeps every acquisition and warns about the slice it cannot place', async () => {
    await volViewPage.open(`?urls=[tmp/${MANIFEST_NAME}]`);
    await volViewPage.waitForViews();

    // One card per acquisition, each holding only that acquisition's slices.
    const passes = ACQUISITIONS.map((a) => a.sliceCount).sort((a, b) => a - b);
    await volViewPage.waitForVolumeCardSliceCounts(passes);
    expect(await volViewPage.getNotificationsCount()).toEqual(0);

    await dropFiles([POSITIONLESS]);

    // The passes are untouched, and the unplaceable slice is a volume of its
    // own rather than a member of any.
    await volViewPage.waitForVolumeCardSliceCounts([1, ...passes]);

    await volViewPage.waitForNotification();
    await volViewPage.openNotifications();
    const dialog = await $('.message-center');
    await dialog.waitForDisplayed();
    expect(await dialog.getText()).toContain(
      'A DICOM series did not load as one sound volume'
    );
  });
});
