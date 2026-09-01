import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { resolveRasterizeTarget } from '@/src/components/tools/polygon/rasterizeTarget';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';

const DIMENSIONS: [number, number, number] = [4, 4, 2];
const VOXEL_COUNT = DIMENSIONS[0] * DIMENSIONS[1] * DIMENSIONS[2];

async function seatImage(id: string, name = 'CT') {
  const image = vtkImageData.newInstance({ spacing: [1, 1, 1] });
  image.setDimensions(DIMENSIONS);
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

const store = () => useSegmentationStore();

describe('polygon rasterize target', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('allocates storage for a segment that has none', async () => {
    await seatImage('img-1');
    const segmentation = store().ensureSegmentationForImage('img-1');
    const segment = store().createSegment(segmentation.id, { name: 'Tumor' });

    const target = resolveRasterizeTarget('img-1', segment.id);

    expect(target.labelValue).toBe(1);
    expect(store().artifactsForImage('img-1')).toEqual([target.artifactId]);
    expect(target.labelmap).toBe(store().artifactIndex[target.artifactId]);
    expect(
      store().getSegment(segmentation.id, segment.id).representations.labelmap
    ).toMatchObject({ artifactId: target.artifactId, labelValue: 1 });
  });

  it('resolves the given segment rather than the first one', async () => {
    await seatImage('img-1');
    const segmentation = store().ensureSegmentationForImage('img-1');
    const first = store().createSegment(segmentation.id, { name: 'Other' });
    store().ensureLabelmapBinding(segmentation.id, first.id);
    const second = store().createSegment(segmentation.id, { name: 'Tumor' });

    const target = resolveRasterizeTarget('img-1', second.id);

    expect(target.labelValue).toBe(2);
    expect(target.artifactId).toBe(
      store().resolveLabelmapBinding(segmentation.id, first.id)!.artifactId
    );
  });

  it('reuses the same binding on a second rasterize', async () => {
    await seatImage('img-1');
    const segmentation = store().ensureSegmentationForImage('img-1');
    const segment = store().createSegment(segmentation.id, { name: 'Tumor' });

    const first = resolveRasterizeTarget('img-1', segment.id);
    const second = resolveRasterizeTarget('img-1', segment.id);

    expect(second.artifactId).toBe(first.artifactId);
    expect(second.labelValue).toBe(first.labelValue);
    expect(store().artifactsForImage('img-1')).toHaveLength(1);
  });

  it('leaves the active segment alone', async () => {
    await seatImage('img-1');
    const segmentation = store().ensureSegmentationForImage('img-1');
    const active = store().createSegment(segmentation.id, { name: 'Active' });
    const other = store().createSegment(segmentation.id, { name: 'Other' });
    store().setActiveSegment(segmentation.id, active.id);

    resolveRasterizeTarget('img-1', other.id);

    expect(store().activeTarget).toEqual({
      segmentationId: segmentation.id,
      segmentId: active.id,
    });
  });

  it('rejects a segment that does not belong to the image', async () => {
    await seatImage('img-1');
    await seatImage('img-2');
    const other = store().ensureSegmentationForImage('img-2');
    const segment = store().createSegment(other.id, { name: 'Tumor' });

    expect(() => resolveRasterizeTarget('img-1', segment.id)).toThrow();
  });

  it('rasterizes into a default segment when the image has none', async () => {
    await seatImage('img-1');

    const target = resolveRasterizeTarget('img-1', undefined);

    const segmentation = store().getSegmentationForImage('img-1');
    expect(Object.keys(segmentation!.segments)).toHaveLength(1);
    expect(store().activeTarget?.segmentId).toBe(
      Object.keys(segmentation!.segments)[0]
    );
    expect(target.labelmap).toBe(store().artifactIndex[target.artifactId]);
    expect(target.segmentId).toBe(Object.keys(segmentation!.segments)[0]);
  });

  it('reuses the default segment on a second rasterize', async () => {
    await seatImage('img-1');

    const first = resolveRasterizeTarget('img-1', undefined);
    const second = resolveRasterizeTarget('img-1', undefined);

    expect(second.artifactId).toBe(first.artifactId);
    expect(second.labelValue).toBe(first.labelValue);
    expect(
      Object.keys(store().getSegmentationForImage('img-1')!.segments)
    ).toHaveLength(1);
  });

  it('rasterizes into the default segment when the tool id is stale', async () => {
    await seatImage('img-1');
    const segmentation = store().ensureSegmentationForImage('img-1');
    const segment = store().createSegment(segmentation.id, { name: 'Tumor' });
    store().deleteSegment(segmentation.id, segment.id);

    // The tool keeps the deleted segment's id; that must not block rasterizing.
    const target = resolveRasterizeTarget('img-1', segment.id);

    expect(target.segmentId).not.toBe(segment.id);
    expect(store().getSegmentationForImage('img-1')!.segments).toHaveProperty(
      target.segmentId
    );
  });
});
