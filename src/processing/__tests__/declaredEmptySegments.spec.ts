import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

import type { SegmentDescriptor } from '@/backend-contract';
import {
  applyIntent,
  appApplyDependencies,
} from '@/src/processing/applyResults';
import { listMasks } from '@/src/segmentation/model';
import { isEmptyExtent } from '@/src/segmentation/geometry';
import { segmentRenderMask } from '@/src/segmentation/rendering/renderMask';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import {
  inMemoryArtifactIO,
  manifestForImages,
  markedVoxels,
  parentImage,
  seatImage,
  serializeToStateFiles,
  store,
  type Index3,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';

// ---------------------------------------------------------------------------
// A result declares the bins its run looked for, and the labelmap carries the
// voxels it found. The maintainer's decision: a segment a result DECLARES but
// leaves EMPTY still appears, as an empty row. A run that looked for a spleen
// and found none must not read the same as a run that never looked, so the
// declaration is what mints the segment, not the voxels.
// ---------------------------------------------------------------------------

const GRID = { dimensions: [4, 4, 4] as Index3 };
const LIVER_INDEX: Index3 = [1, 1, 1];
const red = [255, 0, 0, 255] as [number, number, number, number];
const blue = [0, 0, 255, 255] as [number, number, number, number];

const DECLARED: SegmentDescriptor[] = [
  { value: 1, name: 'Liver', color: red },
  { value: 2, name: 'Spleen', color: blue },
];

const registry = () => useSegmentStore().segments;

const importResult = (segments: SegmentDescriptor[]) =>
  applyIntent(
    {
      intent: 'import-segmentation',
      id: 'result',
      name: 'output.nrrd',
      url: 'https://example/output.nrrd',
      segments,
      source: { providerId: 'provider', jobId: 'job', outputId: 'mask' },
    },
    {
      jobId: 'job',
      taskId: 'task',
      providerId: 'provider',
      submittedAt: '',
      activeDatasetId: 'parent',
    },
    {
      ...appApplyDependencies(),
      importVolume: async () => 'output',
      removeDataset: (id) => useImageCacheStore().removeImage(id),
    }
  );

/** What each mask on an image is named, and where its voxels sit. */
const segmentsOn = (imageId: string) =>
  listMasks(store().getSegmentationForImage(imageId)!).map((segment) => ({
    name: registry().appearanceOf(segment.segmentId).name,
    color: [...registry().appearanceOf(segment.segmentId).color],
    extent: segment.representations.labelmap
      ? [...segment.representations.labelmap.extent]
      : undefined,
    marks: markedVoxels(segment.id),
  }));

/** Only value 1 is written, so value 2 is declared and never filled. */
async function seatScene() {
  await seatImage('parent', { ...GRID, name: 'CT' });
  const values = new Uint8Array(64);
  values[LIVER_INDEX[0] + LIVER_INDEX[1] * 4 + LIVER_INDEX[2] * 16] = 1;
  await seatImage('output', { ...GRID, name: 'output.nrrd', values });
}

describe('a segment a result declares but leaves empty', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatScene();
  });

  it('appears as an empty row beside the segment that has voxels', async () => {
    expect(await importResult(DECLARED)).toEqual({ status: 'applied' });

    expect(segmentsOn('parent')).toEqual([
      {
        name: 'Liver',
        color: red,
        extent: [1, 1, 1, 1, 1, 1],
        marks: [[...LIVER_INDEX, SEGMENT_VALUE]],
      },
      { name: 'Spleen', color: blue, extent: [0, -1, 0, -1, 0, -1], marks: [] },
    ]);
    // The empty row is a real mask record, holding no voxels.
    const spleen = listMasks(store().getSegmentationForImage('parent')!)[1];
    expect(store().maskVoxels(spleen.id).scalars()).toHaveLength(0);
  });

  it('draws nothing for the empty segment', async () => {
    await importResult(DECLARED);

    const spleen = listMasks(store().getSegmentationForImage('parent')!)[1];
    const binding = spleen.representations.labelmap!;
    expect(isEmptyExtent(binding.extent)).toBe(true);
    expect(
      segmentRenderMask(binding.image, parentImage('parent'), binding.extent, {
        axis: 2,
        index: 1,
      })
    ).toBeNull();
  });

  it('keeps both segments across a save and restore', async () => {
    await importResult(DECLARED);
    const before = segmentsOn('parent');
    const io = inMemoryArtifactIO();

    const { parsed, stateFiles } = await serializeToStateFiles(
      manifestForImages(['parent']),
      io
    );

    setActivePinia(createPinia());
    await seatImage('new-parent', { ...GRID, name: 'CT' });
    const result = await useSegmentationStore().deserialize({
      manifest: parsed,
      stateFiles,
      dataIDMap: { parent: 'new-parent' },
      segmentIdMap: useSegmentStore().deserialize(parsed),
      io,
    });
    await nextTick();

    expect(result.skipped).toEqual([]);
    expect(segmentsOn('new-parent')).toEqual(before);
  });
});
