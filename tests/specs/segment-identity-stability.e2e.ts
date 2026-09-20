import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { cleanuptotal } from 'wdio-cleanuptotal-service';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { openUrls, waitForDownload } from './utils';
import { ONE_CT_SLICE_DICOM } from '../datasets';
import {
  openAnnotationSegments,
  waitForNamedSegments,
} from './segmentationTestUtils';

const SAVE_TIMEOUT = 40_000;

const isGzip = (buf: Buffer) => buf[0] === 0x1f && buf[1] === 0x8b;

const parseHeader = (headerText: string) => {
  const header = new Map<string, string>();
  headerText.split('\n').forEach((line) => {
    const keyValue = line.indexOf(':=');
    if (keyValue >= 0) {
      const key = line.slice(0, keyValue).trim();
      header.set(key, line.slice(keyValue + 2).trim());
      return;
    }
    const field = line.indexOf(':');
    if (field >= 0 && !line.startsWith('#') && !line.startsWith('NRRD')) {
      const key = line.slice(0, field).trim();
      header.set(key, line.slice(field + 1).trim());
    }
  });
  return header;
};

/** VolView writes with compression, so the data section arrives gzipped. */
const readSegNrrd = (filePath: string) => {
  const file = fs.readFileSync(filePath);
  const raw = isGzip(file) ? zlib.gunzipSync(file) : file;
  const split = raw.toString('latin1').indexOf('\n\n');
  const header = parseHeader(raw.toString('latin1', 0, split));

  const data = raw.subarray(split + 2);
  const voxels = isGzip(data) ? zlib.gunzipSync(data) : data;
  return { header, voxels };
};

const downloadSegmentGroup = async (stem: string) => {
  const filePath = path.join(TEMP_DIR, `${stem}.seg.nrrd`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  cleanuptotal.addCleanup(async () => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  await volViewPage.clickSaveSegmentsButton();
  const input = volViewPage.saveSegmentsFilenameInput;
  await input.waitForDisplayed();
  await setValueVueInput(input, stem);
  await volViewPage.saveSegmentsConfirmButton.click();

  await waitForDownload(filePath, SAVE_TIMEOUT);
  return readSegNrrd(filePath);
};

const editOnlySegment = async (name: string, red: number) => {
  await $('[data-testid="segment-list"] button i[class~="mdi-pencil"]').click();
  const dialog = $('div[role="dialog"]');
  await dialog.waitForDisplayed();
  await setValueVueInput(dialog.$('.v-text-field input'), name);
  await setValueVueInput(dialog.$('.v-color-picker-edit input'), String(red));
  await volViewPage.editLabelModalDoneButton.click();
  await dialog.waitForDisplayed({ reverse: true });
};

describe('Segment identity under rename and recolor', function () {
  this.timeout(120_000);

  it('leaves the exported voxels untouched while the name and color follow', async () => {
    await openUrls([ONE_CT_SLICE_DICOM]);

    await volViewPage.activatePaint();
    const views2D = await volViewPage.getViews2D();
    await volViewPage.paintStrokeOnView(views2D[0]);
    await openAnnotationSegments();
    await waitForNamedSegments();

    const stamp = Date.now();
    const before = await downloadSegmentGroup(`identity-before-${stamp}`);
    expect(before.header.get('Segment0_Name')).toEqual('Segment 1');
    expect(before.voxels.some((voxel) => voxel !== 0)).toBe(true);

    await editOnlySegment('Tumor', 0);

    const after = await downloadSegmentGroup(`identity-after-${stamp}`);
    expect(after.header.get('Segment0_Name')).toEqual('Tumor');
    expect(after.header.get('Segment0_Color')).not.toEqual(
      before.header.get('Segment0_Color')
    );

    // Same label value, same voxels: the edits moved identity, not geometry.
    expect(after.header.get('Segment0_LabelValue')).toEqual(
      before.header.get('Segment0_LabelValue')
    );
    expect(after.voxels.equals(before.voxels)).toBe(true);
  });
});
