import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  recordFor,
  lockSegment,
} from '@/src/store/__tests__/segmentMaskFixtures';
import { nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { resolveRasterizeTarget } from '@/src/components/tools/polygon/rasterizeTarget';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useMessageStore } from '@/src/store/messages';
import { useSegmentationStore } from '@/src/store/segmentations';
import { useSegmentTypeStore } from '@/src/store/segmentTypes';

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
const types = () => useSegmentTypeStore().types;

/** A type with this image's record for it, which is what a polygon names. */
const makeSegment = (imageId: string, name: string) => {
  const typeId = types().mintType({ name });
  return { typeId, record: recordFor(imageId, typeId) };
};

/** The resolved target, for the cases that expect one. */
const targetOf = (imageId: string, typeId: string | undefined) =>
  resolveRasterizeTarget(imageId, typeId)!;

describe('polygon rasterize target', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('allocates storage for a record that has none', async () => {
    await seatImage('img-1');
    const segment = makeSegment('img-1', 'Tumor');

    const target = targetOf('img-1', segment.typeId);

    expect(target.labelValue).toBe(1);
    expect(
      store()
        .segmentLayersForImage('img-1')
        .map((layer) => layer.artifactId)
    ).toEqual([target.artifactId]);
    expect(target.voxels.image()).toBe(
      store().artifactIndex[target.artifactId]
    );
    expect(
      store().getSegment(segment.record.id).representations.labelmap
    ).toMatchObject({ artifactId: target.artifactId, labelValue: 1 });
  });

  it('resolves the given type rather than the first one', async () => {
    await seatImage('img-1');
    const first = makeSegment('img-1', 'Other');
    store().segmentVoxels(first.record.id).materialize();
    const second = makeSegment('img-1', 'Tumor');

    const target = targetOf('img-1', second.typeId);

    expect(target.labelValue).toBe(2);
    expect(target.artifactId).not.toBe(
      store().resolveLabelmapBinding(first.record.id)!.artifactId
    );
  });

  it('reuses the same binding on a second rasterize', async () => {
    await seatImage('img-1');
    const segment = makeSegment('img-1', 'Tumor');

    const first = targetOf('img-1', segment.typeId);
    const second = targetOf('img-1', segment.typeId);

    expect(second.artifactId).toBe(first.artifactId);
    expect(second.labelValue).toBe(first.labelValue);
    expect(store().segmentLayersForImage('img-1')).toHaveLength(1);
  });

  it('leaves the selected type alone', async () => {
    await seatImage('img-1');
    const active = makeSegment('img-1', 'Active');
    const other = makeSegment('img-1', 'Other');
    types().selectType(active.typeId);

    targetOf('img-1', other.typeId);

    expect(types().selectedTypeId.value).toBe(active.typeId);
  });

  it('takes this image record for a type painted on another image', async () => {
    await seatImage('img-1');
    await seatImage('img-2');
    const elsewhere = makeSegment('img-2', 'Tumor');

    const target = targetOf('img-1', elsewhere.typeId);

    expect(target.segmentId).not.toBe(elsewhere.record.id);
    expect(store().getSegment(target.segmentId).typeId).toBe(elsewhere.typeId);
  });

  it('refuses a locked record before allocating storage for it', async () => {
    await seatImage('img-1');
    const segment = makeSegment('img-1', 'Tumor');
    lockSegment(segment.record.id, true);

    expect(resolveRasterizeTarget('img-1', segment.typeId)).toBeUndefined();

    expect(
      store().getSegment(segment.record.id).representations.labelmap
    ).toBeUndefined();
    expect(store().segmentLayersForImage('img-1')).toEqual([]);
    expect(
      useMessageStore().messages.map((message) => message.title)
    ).toContain('Cannot rasterize into a locked segment');
  });

  it('rasterizes into a minted type when nothing is selected', async () => {
    await seatImage('img-1');

    const target = targetOf('img-1', undefined);

    const segmentation = store().getSegmentationForImage('img-1');
    expect(Object.keys(segmentation!.segments)).toHaveLength(1);
    expect(types().selectedTypeId.value).toBe(target.typeId);
    expect(target.voxels.image()).toBe(
      store().artifactIndex[target.artifactId]
    );
    expect(target.segmentId).toBe(Object.keys(segmentation!.segments)[0]);
  });

  it('reuses the default segment on a second rasterize', async () => {
    await seatImage('img-1');

    const first = targetOf('img-1', undefined);
    const second = targetOf('img-1', undefined);

    expect(second.artifactId).toBe(first.artifactId);
    expect(second.labelValue).toBe(first.labelValue);
    expect(
      Object.keys(store().getSegmentationForImage('img-1')!.segments)
    ).toHaveLength(1);
  });

  it('hands back the accessor the polygon writes through', async () => {
    await seatImage('img-1');
    const segment = makeSegment('img-1', 'Tumor');

    const target = targetOf('img-1', segment.typeId);
    target.voxels.ensureContains([0, 3, 0, 0, 0, 0]);
    // fillPoly writes voxel offsets into the live buffer, so a copy would be
    // rasterized and thrown away.
    target.voxels.scalars()[3] = target.labelValue;

    expect(
      store()
        .artifactIndex[target.artifactId].getPointData()
        .getScalars()
        .getData()[3]
    ).toBe(target.labelValue);
  });

  it('rasterizes into a minted type when the tool names a deleted one', async () => {
    await seatImage('img-1');
    const segment = makeSegment('img-1', 'Tumor');
    types().deleteType(segment.typeId);

    // The tool keeps the deleted type's id; that must not block rasterizing.
    const target = targetOf('img-1', segment.typeId);

    expect(target.typeId).not.toBe(segment.typeId);
    expect(store().getSegmentationForImage('img-1')!.segments).toHaveProperty(
      target.segmentId
    );
  });
});
