import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';

// ---------------------------------------------------------------------------
// Segment ids are globally unique and one segmentation per image is enforced,
// so a (segmentationId, segmentId) pair carries no more information than the
// segment id alone. Every segment-addressed store entry point takes the bare
// id, and the active segment is that id rather than a pair.
// ---------------------------------------------------------------------------

const DIMENSIONS = [4, 4, 2] as const;
const VOXEL_COUNT = DIMENSIONS[0] * DIMENSIONS[1] * DIMENSIONS[2];

const store = () => useSegmentationStore();

async function seatImage(id: string, name = 'CT') {
  const image = vtkImageData.newInstance({ spacing: [1, 1, 1] });
  image.setDimensions(DIMENSIONS as unknown as [number, number, number]);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: new Uint8Array(VOXEL_COUNT),
    })
  );
  image.computeTransforms();
  useImageCacheStore().addVTKImageData(image, name, { id });
  await nextTick();
  return id;
}

const makeSegment = (imageId: string, name?: string) => {
  const segmentation = store().ensureSegmentationForImage(imageId);
  return store().createSegment(
    segmentation.id,
    name === undefined ? undefined : { name }
  );
};

describe('segment addressing by id alone', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1');
  });

  it('reads a segment by its id', () => {
    const segment = makeSegment('img-1', 'Tumor');

    expect(store().getSegment(segment.id).name).toBe('Tumor');
  });

  it('updates a segment by its id', () => {
    const segment = makeSegment('img-1', 'Tumor');

    store().updateSegment(segment.id, { name: 'Lesion' });

    expect(store().getSegment(segment.id).name).toBe('Lesion');
  });

  it('deletes a segment by its id', () => {
    const segment = makeSegment('img-1', 'Tumor');
    const segmentation = store().getSegmentationForImage('img-1')!;

    store().deleteSegment(segment.id);

    expect(segmentation.order).toEqual([]);
    expect(segmentation.segments[segment.id]).toBeUndefined();
  });

  it('binds and resolves storage by segment id', () => {
    const segment = makeSegment('img-1', 'Tumor');

    const binding = store().ensureLabelmapBinding(segment.id);

    expect(binding.labelValue).toBe(1);
    expect(store().resolveLabelmapBinding(segment.id)?.labelValue).toBe(1);
    expect(store().artifactIndex[binding.artifactId].getDimensions()).toEqual([
      ...DIMENSIONS,
    ]);
  });

  it('hands out a voxel accessor by segment id', () => {
    const segment = makeSegment('img-1', 'Tumor');

    const voxels = store().segmentVoxels(segment.id);

    expect(voxels.exists()).toBe(false);
    voxels.materialize();
    expect(voxels.exists()).toBe(true);
    expect(voxels.scalars().length).toBe(VOXEL_COUNT);
  });
});

describe('active segment as a bare id', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1');
  });

  it('reports the active segment as its id', () => {
    const segment = makeSegment('img-1', 'Tumor');

    store().setActiveSegment(segment.id);

    expect(store().activeSegmentId).toBe(segment.id);
  });

  it('forgets an active segment that was deleted', () => {
    const segment = makeSegment('img-1', 'Tumor');
    store().setActiveSegment(segment.id);

    store().deleteSegment(segment.id);

    expect(store().activeSegmentId).toBeUndefined();
  });

  it('clears the active segment to nothing', () => {
    const segment = makeSegment('img-1', 'Tumor');
    store().setActiveSegment(segment.id);

    store().clearActiveSegment();

    expect(store().activeSegmentId).toBeUndefined();
    expect(store().getSegment(segment.id).name).toBe('Tumor');
  });

  it('resolves an edit target to a segment id', async () => {
    await seatImage('img-2');
    const segment = makeSegment('img-1', 'Tumor');
    store().setActiveSegment(segment.id);

    const resolved = store().resolveEditTarget('img-1');

    expect(resolved).toBe(segment.id);
    expect(store().activeSegmentId).toBe(segment.id);
  });

  it('resolves an edit target on an image with no segments to a new id', () => {
    const resolved = store().resolveEditTarget('img-1');

    expect(typeof resolved).toBe('string');
    expect(store().getSegment(resolved).name).toBe('Segment 1');
    expect(store().activeSegmentId).toBe(resolved);
  });

  it('honors a preferred segment id without changing the active one', () => {
    const active = makeSegment('img-1', 'Tumor');
    const other = makeSegment('img-1', 'Node');
    store().setActiveSegment(active.id);

    const resolved = store().resolveEditTarget('img-1', other.id);

    expect(resolved).toBe(other.id);
    expect(store().activeSegmentId).toBe(active.id);
  });
});
