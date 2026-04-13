import * as path from 'path';
import * as fs from 'fs';
import { cleanuptotal } from 'wdio-cleanuptotal-service';
import { waitForFileExists } from './utils';
import { volViewPage } from '../pageobjects/volview.page';
import { TEMP_DIR } from '../../wdio.shared.conf';

const SAVE_TIMEOUT = 40000;

const loadSampleWithSegmentGroup = async (name: string) => {
  await volViewPage.open();
  await volViewPage.downloadProstateSample();
  await volViewPage.waitForViews();
  await volViewPage.createSegmentGroup(name);
};

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

const expectDirectSegmentGroupDownload = async (
  segmentGroupName: string,
  expectedStem: string
) => {
  await loadSampleWithSegmentGroup(segmentGroupName);

  await volViewPage.clickFirstSegmentGroupSaveButton();

  const input = await volViewPage.saveSegmentGroupFilenameInput;
  await input.waitForDisplayed();
  expect(await input.getValue()).toEqual(expectedStem);

  const downloadedPath = prepareDownloadedFilePath(`${expectedStem}.seg.nrrd`);
  const confirm = await volViewPage.saveSegmentGroupConfirmButton;
  await confirm.click();

  await waitForFileExists(downloadedPath, SAVE_TIMEOUT);
};

describe('Segment group download', () => {
  it('sanitizes invalid characters for direct segment group downloads', async () => {
    await expectDirectSegmentGroupDownload(
      'Liver: left/right*?',
      'Liver left right'
    );
  });

  it('sanitizes reserved Windows names for direct segment group downloads', async () => {
    await expectDirectSegmentGroupDownload('CON', 'CON_');
  });

  it('preserves valid segment group names for direct segment group downloads', async () => {
    await expectDirectSegmentGroupDownload(
      'Prostate Segmentation',
      'Prostate Segmentation'
    );
  });
});
