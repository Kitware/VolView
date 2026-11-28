import * as fs from 'node:fs';
import * as zlib from 'node:zlib';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  setValueVueInput,
  type VolViewPage,
} from '../pageobjects/volview.page';
import type { SaveDownload } from '../scratch';
import { ONE_CT_SLICE_DICOM } from '../datasets';

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

const downloadSegmentation = async (
  {
    volview,
    saveDownload,
  }: { volview: VolViewPage; saveDownload: SaveDownload },
  stem: string
) => {
  await volview.clickSaveSegmentsButton();
  const input = volview.saveSegmentsFilenameInput;
  await expect(input).toBeVisible();
  await setValueVueInput(input, stem);
  const filePath = await saveDownload(() =>
    volview.saveSegmentsConfirmButton.click()
  );
  return readSegNrrd(filePath);
};

const editOnlySegment = async (
  { page, volview }: { page: Page; volview: VolViewPage },
  name: string,
  red: number
) => {
  await page
    .locator('[data-testid="segment-list"] button i[class~="mdi-pencil"]')
    .click();
  const dialog = page.locator('div[role="dialog"]').first();
  await expect(dialog).toBeVisible();
  await setValueVueInput(dialog.locator('.v-text-field input').first(), name);
  await setValueVueInput(
    dialog.locator('.v-color-picker-edit input').first(),
    String(red)
  );
  await volview.editLabelModalDoneButton.click();
  await expect(dialog).toBeHidden();
};

test.describe('Segment identity under rename and recolor', () => {
  test('leaves the exported voxels untouched while the name and color follow', async ({
    page,
    volview,
    utils,
    segmentation,
    saveDownload,
  }) => {
    await utils.openUrls([ONE_CT_SLICE_DICOM]);

    await volview.activatePaint();
    await volview.paintStrokeOnView(volview.views2D.first());
    await segmentation.openAnnotationSegments();
    await segmentation.waitForNamedSegments();

    const download = { volview, saveDownload };
    const stamp = Date.now();
    const before = await downloadSegmentation(
      download,
      `identity-before-${stamp}`
    );
    expect(before.header.get('Segment0_Name')).toEqual('Segment 1');
    expect(before.voxels.some((voxel) => voxel !== 0)).toBe(true);

    await editOnlySegment({ page, volview }, 'Tumor', 0);

    const after = await downloadSegmentation(
      download,
      `identity-after-${stamp}`
    );
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
