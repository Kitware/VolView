import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import JSZip from 'jszip';
import { cleanuptotal } from 'wdio-cleanuptotal-service';
import { setValueVueInput, volViewPage } from '../pageobjects/volview.page';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { openUrls, waitForDownload } from './utils';
import { ONE_CT_SLICE_DICOM } from '../datasets';
import {
  addSegment,
  allowOverlap,
  lockSegment,
  openAnnotationSegments,
  waitForNamedSegments,
} from './segmentationTestUtils';

const SAVE_TIMEOUT = 40_000;

const overlapNotice = () => $('[data-testid="save-overlap-notice"]');

const isGzip = (buf: Buffer) => buf[0] === 0x1f && buf[1] === 0x8b;

/** VolView writes with compression, so the data section arrives gzipped. */
const readSegNrrd = (file: Buffer) => {
  const raw = isGzip(file) ? zlib.gunzipSync(file) : file;
  const split = raw.toString('latin1').indexOf('\n\n');

  const header = new Map<string, string>();
  raw
    .toString('latin1', 0, split)
    .split('\n')
    .forEach((line) => {
      const customSeparator = line.indexOf(':=');
      if (customSeparator >= 0) {
        header.set(
          line.slice(0, customSeparator).trim(),
          line.slice(customSeparator + 2).trim()
        );
        return;
      }
      const separator = line.indexOf(':');
      if (separator >= 0 && !line.startsWith('#')) {
        header.set(
          line.slice(0, separator).trim(),
          line.slice(separator + 1).trim()
        );
      }
    });

  const data = raw.subarray(split + 2);
  const voxels = isGzip(data) ? zlib.gunzipSync(data) : data;
  const offsetsWhere = (keep: (voxel: number) => boolean) =>
    Array.from(voxels.entries())
      .filter(([, voxel]) => keep(voxel))
      .map(([offset]) => offset);
  const labelValueOf = (name: string) => {
    const [nameKey] =
      [...header].find(
        ([key, value]) => /^Segment\d+_Name$/.test(key) && value === name
      ) ?? [];
    return Number(
      nameKey && header.get(nameKey.replace('_Name', '_LabelValue'))
    );
  };
  return {
    header,
    foreground: offsetsWhere((voxel) => voxel !== 0),
    segmentVoxels: (name: string) => {
      const value = labelValueOf(name);
      return offsetsWhere((voxel) => voxel === value);
    },
  };
};

const geometryFields = [
  'type',
  'dimension',
  'sizes',
  'space',
  'space directions',
  'space origin',
] as const;

const paintNewSegment = async (offsetX = 0) => {
  await addSegment();
  const views2D = await volViewPage.getViews2D();
  await volViewPage.paintStrokeOnView(views2D[0], offsetX);
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

const saveSingleLayer = async (stem: string) => {
  const filePath = path.join(TEMP_DIR, `${stem}.seg.nrrd`);
  fs.rmSync(filePath, { force: true });
  cleanuptotal.addCleanup(async () => fs.rmSync(filePath, { force: true }));

  await setValueVueInput(volViewPage.saveSegmentsFilenameInput, stem);
  await volViewPage.saveSegmentsConfirmButton.click();
  await waitForDownload(filePath, SAVE_TIMEOUT);
  return readSegNrrd(fs.readFileSync(filePath));
};

describe('Painting one segment over another', function () {
  this.timeout(120_000);

  beforeEach(async () => {
    await openUrls([ONE_CT_SLICE_DICOM]);
    await volViewPage.activatePaint();
    const views2D = await volViewPage.getViews2D();
    await volViewPage.paintStrokeOnView(views2D[0]);
    await openAnnotationSegments();
    await waitForNamedSegments();
  });

  // One file carries one label per voxel, so the save announces an archive
  // exactly when two segments hold a voxel in common. That notice is what makes
  // overlap observable from the panel.
  it('takes the voxels of an unlocked segment', async () => {
    await paintNewSegment();
    await openSaveDialog();

    await expect(overlapNotice()).not.toBeDisplayed();
  });

  it('paints around a locked segment without taking or sharing its voxels', async () => {
    await openSaveDialog();
    const baseline = await saveSingleLayer(`around-baseline-${Date.now()}`);
    expect(baseline.foreground.length).toBeGreaterThan(0);
    await lockSegment('Segment 1');
    // Half a loop over: the stroke crosses Segment 1 and runs past it.
    await paintNewSegment(20);
    await openSaveDialog();

    await expect(overlapNotice()).not.toBeDisplayed();
    const saved = await saveSingleLayer(`around-${Date.now()}`);
    expect(saved.segmentVoxels('Segment 1')).toEqual(baseline.foreground);
    expect(saved.segmentVoxels('Segment 2').length).toBeGreaterThan(0);
  });

  it('shares the voxels of an unlocked segment while overlap is allowed', async () => {
    await allowOverlap();
    await paintNewSegment();
    await openSaveDialog();

    await expect(overlapNotice()).toBeDisplayed();
  });

  it('saves overlapping segments losslessly, one file per layer', async () => {
    await openSaveDialog();
    const baseline = await saveSingleLayer(`overlap-baseline-${Date.now()}`);
    expect(baseline.foreground.length).toBeGreaterThan(0);
    geometryFields.forEach((field) => {
      expect(baseline.header.get(field)).toBeDefined();
    });
    expect(baseline.header.get('type')).toBe('unsigned char');
    await allowOverlap();
    await paintNewSegment();
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
      expect(layer.foreground).toEqual(baseline.foreground);
      expect(geometryFields.map((field) => layer.header.get(field))).toEqual(
        geometryFields.map((field) => baseline.header.get(field))
      );
    });
  });
});
