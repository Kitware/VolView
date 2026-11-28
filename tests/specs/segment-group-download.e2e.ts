import * as path from 'node:path';
import { test, expect } from '../fixtures';
import {
  setValueVueInput,
  type VolViewPage,
} from '../pageobjects/volview.page';
import type { SaveDownload } from '../scratch';
import { PROSTATEX_DATASET } from '../datasets';
import type { SegmentationUtils } from './segmentationTestUtils';

// A stroke is what gives the image a mask to save: adding a type creates
// identity only.
const paintOnViewedImage = async (
  volview: VolViewPage,
  segmentation: SegmentationUtils
) => {
  await volview.activatePaint();
  await volview.paintStrokeOnView(volview.views2D.first());
  await segmentation.openAnnotationSegments();
};

// The name a download carries is the one typed into the save dialog.
const expectDirectSegmentDownload = async (
  {
    volview,
    saveDownload,
  }: { volview: VolViewPage; saveDownload: SaveDownload },
  typedName: string,
  expectedStem: string
) => {
  await volview.clickSaveSegmentsButton();

  const input = volview.saveSegmentsFilenameInput;
  await expect(input).toBeVisible();
  await setValueVueInput(input, typedName);

  const confirm = volview.saveSegmentsConfirmButton;
  const downloadedPath = await saveDownload(() => confirm.click());
  expect(path.basename(downloadedPath)).toBe(`${expectedStem}.seg.nrrd`);

  await expect(confirm).toBeHidden();
};

test.describe('Segment download', () => {
  test('uses the image name by default and sanitizes custom download names', async ({
    volview,
    utils,
    segmentation,
    saveDownload,
  }) => {
    await utils.openUrls([PROSTATEX_DATASET]);
    await segmentation.openAnnotationSegments();
    await paintOnViewedImage(volview, segmentation);

    await volview.clickSaveSegmentsButton();

    const input = volview.saveSegmentsFilenameInput;
    await expect(input).toBeVisible();
    const stem = await input.inputValue();
    expect(stem).toBe('t2_tse_tra');

    const confirm = volview.saveSegmentsConfirmButton;
    const downloadedPath = await saveDownload(() => confirm.click());
    expect(path.basename(downloadedPath)).toBe(`${stem}.seg.nrrd`);

    await expect(confirm).toBeHidden();

    const download = { volview, saveDownload };
    await expectDirectSegmentDownload(
      download,
      'Liver: left/right*?',
      'Liver left right'
    );
    await expectDirectSegmentDownload(download, 'CON', 'CON_');
    await expectDirectSegmentDownload(
      download,
      'Prostate Segmentation',
      'Prostate Segmentation'
    );
  });
});
