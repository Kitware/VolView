import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import JSZip from 'jszip';
import { cleanuptotal } from 'wdio-cleanuptotal-service';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { openUrls, waitForDownload } from './utils';
import { ONE_CT_SLICE_DICOM } from './configTestUtils';
import {
  addSegment,
  lockSegment,
  openAnnotationSegments,
  showFirstSegmentGroup,
} from './segmentationTestUtils';

const SAVE_TIMEOUT = 40_000;

const overlapNotice = () => $('[data-testid="save-overlap-notice"]');

const isGzip = (buf: Buffer) => buf[0] === 0x1f && buf[1] === 0x8b;

/**
 * A `.seg.nrrd`'s per-segment header fields and its decoded voxel bytes.
 * VolView writes with compression, so the data section arrives gzipped.
 */
const readSegNrrd = (file: Buffer) => {
  const raw = isGzip(file) ? zlib.gunzipSync(file) : file;
  const split = raw.toString('latin1').indexOf('\n\n');

  const header = new Map<string, string>();
  raw
    .toString('latin1', 0, split)
    .split('\n')
    .forEach((line) => {
      const separator = line.indexOf(':=');
      if (separator < 0) return;
      header.set(line.slice(0, separator).trim(), line.slice(separator + 2));
    });

  const data = raw.subarray(split + 2);
  return { header, voxels: isGzip(data) ? zlib.gunzipSync(data) : data };
};

/** Paints one stroke into a new segment, over the ground the last one covered. */
const paintNewSegmentOverTheSameSpot = async () => {
  await addSegment();
  const views2D = await volViewPage.getViews2D();
  await volViewPage.paintStrokeOnView(views2D[0]);
};

const openSaveDialog = async () => {
  await volViewPage.clickSaveSegmentsButton();
  await volViewPage.saveSegmentsFilenameInput.waitForDisplayed();
};

const saveAndUnzip = async (stem: string) => {
  const filePath = path.join(TEMP_DIR, `${stem}.zip`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  cleanuptotal.addCleanup(async () => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  await setValueVueInput(volViewPage.saveSegmentsFilenameInput, stem);
  await volViewPage.saveSegmentsConfirmButton.click();

  await waitForDownload(filePath, SAVE_TIMEOUT);
  return JSZip.loadAsync(fs.readFileSync(filePath));
};

describe('Painting one segment over another', function () {
  this.timeout(120_000);

  beforeEach(async () => {
    await openUrls([ONE_CT_SLICE_DICOM]);
    await volViewPage.activatePaint();
    const views2D = await volViewPage.getViews2D();
    await volViewPage.paintStrokeOnView(views2D[0]);
    await openAnnotationSegments();
    await showFirstSegmentGroup();
  });

  // One file carries one label per voxel, so the save announces an archive
  // exactly when two segments hold a voxel in common. That notice is what makes
  // overlap observable from the panel.
  it('takes the voxels of an unlocked segment', async () => {
    await paintNewSegmentOverTheSameSpot();
    await openSaveDialog();

    await expect(overlapNotice()).not.toBeDisplayed();
  });

  it('leaves a locked segment holding them, so the two overlap', async () => {
    await lockSegment('Segment 1');
    await paintNewSegmentOverTheSameSpot();
    await openSaveDialog();

    await expect(overlapNotice()).toBeDisplayed();
  });

  it('saves overlapping segments losslessly, one file per layer', async () => {
    await lockSegment('Segment 1');
    await paintNewSegmentOverTheSameSpot();
    await openSaveDialog();

    const stem = `overlap-${Date.now()}`;
    const zip = await saveAndUnzip(stem);

    expect(Object.keys(zip.files).sort()).toEqual([
      `${stem}.seg.nrrd`,
      `${stem}_layer1.seg.nrrd`,
    ]);

    // Each layer carries one of the two segments, and carries its voxels: the
    // overlap costs a file, not a segment.
    const layers = await Promise.all(
      [`${stem}.seg.nrrd`, `${stem}_layer1.seg.nrrd`].map(async (name) =>
        readSegNrrd(Buffer.from(await zip.files[name].async('arraybuffer')))
      )
    );

    expect(layers.map((layer) => layer.header.get('Segment0_Name'))).toEqual([
      'Segment 1',
      'Segment 2',
    ]);
    layers.forEach((layer) => {
      expect(layer.header.get('Segment1_Name')).toBeUndefined();
      expect(layer.voxels.some((voxel) => voxel !== 0)).toBe(true);
    });
  });
});
