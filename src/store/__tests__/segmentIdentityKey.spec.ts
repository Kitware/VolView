import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  seatSpecImage as seatImage,
  SPEC_DIMENSIONS as DIMENSIONS,
  mintSegment,
} from '@/src/store/__tests__/segmentMaskFixtures';

import { useSegmentationStore } from '@/src/store/segmentations';
import { useSegmentStore } from '@/src/store/segments';

// ---------------------------------------------------------------------------
// Record ids are globally unique and one segmentation per image is enforced,
// so a (segmentationId, maskId) pair carries no more information than the
// mask id alone. Every record-addressed store entry point takes the bare id,
// and what an edit targets is the selected type on the image being edited.
// ---------------------------------------------------------------------------

const VOXEL_COUNT = DIMENSIONS[0] * DIMENSIONS[1] * DIMENSIONS[2];

const store = () => useSegmentationStore();
const segments = () => useSegmentStore().segments;

const makeMask = (imageId: string, name?: string) => {
  const segmentation = store().ensureSegmentationForImage(imageId);
  return store().createMask(
    segmentation.id,
    mintSegment(name === undefined ? undefined : { name })
  );
};

describe('segment addressing by id alone', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1');
  });

  it('reads a segment by its id', () => {
    const segment = makeMask('img-1', 'Tumor');

    expect(store().getMask(segment.id).segmentId).toBe(segment.segmentId);
    expect(segments().appearanceOf(segment.segmentId).name).toBe('Tumor');
  });

  it('updates a segment by its id', () => {
    const segment = makeMask('img-1', 'Tumor');

    segments().updateSegment(segment.segmentId, { visible: false });

    expect(segments().appearanceOf(segment.segmentId).visible).toBe(false);
  });

  it('deletes a segment by its id', () => {
    const segment = makeMask('img-1', 'Tumor');
    const segmentation = store().getSegmentationForImage('img-1')!;

    store().deleteMask(segment.id);

    expect(segmentation.order).toEqual([]);
    expect(segmentation.masks[segment.id]).toBeUndefined();
  });

  it('binds and resolves storage by segment id', () => {
    const segment = makeMask('img-1', 'Tumor');

    const binding = store().ensureLabelmapBinding(segment.id);

    expect(binding.labelValue).toBe(1);
    expect(store().resolveLabelmapBinding(segment.id)?.labelValue).toBe(1);
    expect(store().artifactMeta[binding.artifactId].parentImage).toBe('img-1');
  });

  it('hands out a voxel accessor by segment id', () => {
    const segment = makeMask('img-1', 'Tumor');

    const voxels = store().maskVoxels(segment.id);

    expect(voxels.exists()).toBe(false);
    voxels.materialize();
    expect(voxels.exists()).toBe(true);
    voxels.ensureContains([
      0,
      DIMENSIONS[0] - 1,
      0,
      DIMENSIONS[1] - 1,
      0,
      DIMENSIONS[2] - 1,
    ]);
    expect(voxels.scalars().length).toBe(VOXEL_COUNT);
  });
});

describe('the edit target of a selected type', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1');
  });

  it('finds this image record for the selected type', () => {
    const segment = makeMask('img-1', 'Tumor');

    segments().selectSegment(segment.segmentId);

    expect(store().findEditTarget('img-1')).toBe(segment.id);
  });

  it('finds no target once the record is deleted', () => {
    const segment = makeMask('img-1', 'Tumor');
    segments().selectSegment(segment.segmentId);

    store().deleteMask(segment.id);

    expect(store().findEditTarget('img-1')).toBeUndefined();
    expect(segments().getSegment(segment.segmentId)).toBeDefined();
  });

  it('finds no target with nothing selected', () => {
    const segment = makeMask('img-1', 'Tumor');
    segments().selectSegment(segment.segmentId);

    segments().selectSegment(undefined);

    expect(store().findEditTarget('img-1')).toBeUndefined();
    expect(segments().appearanceOf(segment.segmentId).name).toBe('Tumor');
  });

  it('resolves an edit target to a mask id', async () => {
    await seatImage('img-2');
    const segment = makeMask('img-1', 'Tumor');
    segments().selectSegment(segment.segmentId);

    const resolved = store().resolveEditTarget('img-1');

    expect(resolved).toBe(segment.id);
    expect(segments().selectedSegmentId.value).toBe(segment.segmentId);
  });

  it('resolves an edit target on an image with no records to a new id', () => {
    const resolved = store().resolveEditTarget('img-1');

    expect(typeof resolved).toBe('string');
    const { segmentId } = store().getMask(resolved);
    expect(segments().appearanceOf(segmentId).name).toBe('Segment 1');
    expect(segments().selectedSegmentId.value).toBe(segmentId);
  });

  it('honors a preferred type without changing the selection', () => {
    const active = makeMask('img-1', 'Tumor');
    const other = makeMask('img-1', 'Node');
    segments().selectSegment(active.segmentId);

    const resolved = store().resolveEditTarget('img-1', other.segmentId);

    expect(resolved).toBe(other.id);
    expect(segments().selectedSegmentId.value).toBe(active.segmentId);
  });
});
