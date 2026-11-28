import * as fs from 'node:fs';
import * as zlib from 'node:zlib';
import JSZip from 'jszip';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  setValueVueInput,
  type VolViewPage,
} from '../pageobjects/volview.page';
import type { SaveDownload } from '../scratch';
import { ONE_CT_SLICE_DICOM } from '../datasets';
import type { SegmentationUtils } from './segmentationTestUtils';

const overlapNotice = (page: Page) =>
  page.locator('[data-testid="save-overlap-notice"]');

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

type Save = { volview: VolViewPage; saveDownload: SaveDownload };

const paintNewSegment = async (
  {
    volview,
    segmentation,
  }: { volview: VolViewPage; segmentation: SegmentationUtils },
  offsetX = 0
) => {
  await segmentation.addSegment();
  await volview.paintStrokeOnView(volview.views2D.first(), offsetX);
};

const openSaveDialog = async (volview: VolViewPage) => {
  await volview.clickSaveSegmentsButton();
  await expect(volview.saveSegmentsFilenameInput).toBeVisible();
};

const saveAndUnzip = async ({ volview, saveDownload }: Save, stem: string) => {
  await setValueVueInput(volview.saveSegmentsFilenameInput, stem);
  const filePath = await saveDownload(() =>
    volview.saveSegmentsConfirmButton.click()
  );
  return JSZip.loadAsync(fs.readFileSync(filePath));
};

const saveSingleLayer = async (
  { volview, saveDownload }: Save,
  stem: string
) => {
  await setValueVueInput(volview.saveSegmentsFilenameInput, stem);
  const filePath = await saveDownload(() =>
    volview.saveSegmentsConfirmButton.click()
  );
  return readSegNrrd(fs.readFileSync(filePath));
};

test.describe('Painting one segment over another', () => {
  test.beforeEach(async ({ volview, utils, segmentation }) => {
    await utils.openUrls([ONE_CT_SLICE_DICOM]);
    await volview.activatePaint();
    await volview.paintStrokeOnView(volview.views2D.first());
    await segmentation.openAnnotationSegments();
    await segmentation.waitForNamedSegments();
  });

  // One file carries one label per voxel, so the save announces an archive
  // exactly when two segments hold a voxel in common. That notice is what makes
  // overlap observable from the panel.
  test('takes the voxels of an unlocked segment', async ({
    page,
    volview,
    segmentation,
    saveDownload,
  }) => {
    const save = { volview, saveDownload };
    await openSaveDialog(volview);
    const baseline = await saveSingleLayer(
      save,
      `replace-baseline-${Date.now()}`
    );
    expect(baseline.foreground.length).toBeGreaterThan(0);
    await paintNewSegment({ volview, segmentation });
    await segmentation.waitForSegmentContent('Segment 2');
    const replaced = await segmentation.segmentRow('Segment 1');
    await expect(
      replaced.locator('[data-testid="reveal-segment-button"]')
    ).toBeDisabled();
    await openSaveDialog(volview);

    await expect(overlapNotice(page)).toBeHidden();
    const saved = await saveSingleLayer(save, `replace-${Date.now()}`);
    expect(saved.segmentVoxels('Segment 2')).toEqual(baseline.foreground);
    expect(saved.foreground).toEqual(baseline.foreground);
    expect(saved.segmentVoxels('Segment 1')).toEqual([]);
  });

  test('paints around a locked segment without taking or sharing its voxels', async ({
    page,
    volview,
    segmentation,
    saveDownload,
  }) => {
    const save = { volview, saveDownload };
    await openSaveDialog(volview);
    const baseline = await saveSingleLayer(
      save,
      `around-baseline-${Date.now()}`
    );
    expect(baseline.foreground.length).toBeGreaterThan(0);
    await segmentation.lockSegment('Segment 1');
    // Half a loop over: the stroke crosses Segment 1 and runs past it.
    await paintNewSegment({ volview, segmentation }, 20);
    await openSaveDialog(volview);

    await expect(overlapNotice(page)).toBeHidden();
    const saved = await saveSingleLayer(save, `around-${Date.now()}`);
    expect(saved.segmentVoxels('Segment 1')).toEqual(baseline.foreground);
    expect(saved.segmentVoxels('Segment 2').length).toBeGreaterThan(0);
  });

  test('saves overlapping segments losslessly, one file per layer', async ({
    page,
    volview,
    segmentation,
    saveDownload,
  }) => {
    const save = { volview, saveDownload };
    await openSaveDialog(volview);
    const baseline = await saveSingleLayer(
      save,
      `overlap-baseline-${Date.now()}`
    );
    expect(baseline.foreground.length).toBeGreaterThan(0);
    geometryFields.forEach((field) => {
      expect(baseline.header.get(field)).toBeDefined();
    });
    expect(baseline.header.get('type')).toBe('unsigned char');
    await segmentation.allowOverlap();
    await paintNewSegment({ volview, segmentation });
    await openSaveDialog(volview);

    await expect(overlapNotice(page)).toBeVisible();

    const stem = `overlap-${Date.now()}`;
    const zip = await saveAndUnzip(save, stem);

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
