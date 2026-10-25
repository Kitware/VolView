import * as path from 'path';
import * as fs from 'fs';
import { cleanuptotal } from 'wdio-cleanuptotal-service';
import { openUrls, waitForFileExists } from './utils';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { PROSTATEX_DATASET } from '../datasets';
import { openAnnotationSegments } from './segmentationTestUtils';

const SAVE_TIMEOUT = 40000;

const prepareDownloadedFilePath = (fileName: string) => {
  const downloadedPath = path.join(TEMP_DIR, fileName);
  if (fs.existsSync(downloadedPath)) {
    fs.unlinkSync(downloadedPath);
  }
  cleanuptotal.addCleanup(async () => {
    if (fs.existsSync(downloadedPath)) {
      fs.unlinkSync(downloadedPath);
    }
  });
  return downloadedPath;
};

// A stroke is what gives the image a mask to save: adding a type creates
// identity only.
const paintOnViewedImage = async () => {
  await volViewPage.activatePaint();
  const views2D = await volViewPage.getViews2D();
  await volViewPage.paintStrokeOnView(views2D[0]);
  await openAnnotationSegments();
};

// The name a download carries is the one typed into the save dialog.
const expectDirectSegmentDownload = async (
  typedName: string,
  expectedStem: string
) => {
  await volViewPage.clickSaveSegmentsButton();

  const input = await volViewPage.saveSegmentsFilenameInput;
  await input.waitForDisplayed();
  await setValueVueInput(input, typedName);

  const downloadedPath = prepareDownloadedFilePath(`${expectedStem}.seg.nrrd`);
  const confirm = await volViewPage.saveSegmentsConfirmButton;
  await confirm.click();

  await waitForFileExists(downloadedPath, SAVE_TIMEOUT);
  await confirm.waitForDisplayed({ reverse: true });
};

describe('Segment download', () => {
  it('uses the image name by default and sanitizes custom download names', async () => {
    await openUrls([PROSTATEX_DATASET]);
    await openAnnotationSegments();
    await paintOnViewedImage();

    await volViewPage.clickSaveSegmentsButton();

    const input = await volViewPage.saveSegmentsFilenameInput;
    await input.waitForDisplayed();
    const stem = await input.getValue();
    expect(stem).toBe('t2_tse_tra');

    const downloadedPath = prepareDownloadedFilePath(`${stem}.seg.nrrd`);
    const confirm = await volViewPage.saveSegmentsConfirmButton;
    await confirm.click();

    await waitForFileExists(downloadedPath, SAVE_TIMEOUT);
    await confirm.waitForDisplayed({ reverse: true });

    await expectDirectSegmentDownload(
      'Liver: left/right*?',
      'Liver left right'
    );
    await expectDirectSegmentDownload('CON', 'CON_');
    await expectDirectSegmentDownload(
      'Prostate Segmentation',
      'Prostate Segmentation'
    );
  });
});
