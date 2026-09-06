import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mintType } from '@/src/store/__tests__/segmentMaskFixtures';
import { nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import { useSegmentTypeStore } from '@/src/store/segmentTypes';

// ---------------------------------------------------------------------------
// Record ids are globally unique and one segmentation per image is enforced,
// so a (segmentationId, recordId) pair carries no more information than the
// record id alone. Every record-addressed store entry point takes the bare id,
// and what an edit targets is the selected type on the image being edited.
// ---------------------------------------------------------------------------

const DIMENSIONS = [4, 4, 2] as const;
const VOXEL_COUNT = DIMENSIONS[0] * DIMENSIONS[1] * DIMENSIONS[2];

const store = () => useSegmentationStore();
const types = () => useSegmentTypeStore().types;

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
    mintType(name === undefined ? undefined : { name })
  );
};

describe('segment addressing by id alone', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1');
  });

  it('reads a segment by its id', () => {
    const segment = makeSegment('img-1', 'Tumor');

    expect(store().getSegment(segment.id).typeId).toBe(segment.typeId);
    expect(types().appearanceOf(segment.typeId).name).toBe('Tumor');
  });

  it('updates a segment by its id', () => {
    const segment = makeSegment('img-1', 'Tumor');

    types().updateType(segment.typeId, { visible: false });

    expect(types().appearanceOf(segment.typeId).visible).toBe(false);
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
    expect(store().artifactMeta[binding.artifactId].parentImage).toBe('img-1');
  });

  it('hands out a voxel accessor by segment id', () => {
    const segment = makeSegment('img-1', 'Tumor');

    const voxels = store().segmentVoxels(segment.id);

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
    const segment = makeSegment('img-1', 'Tumor');

    types().selectType(segment.typeId);

    expect(store().findEditTarget('img-1')).toBe(segment.id);
  });

  it('finds no target once the record is deleted', () => {
    const segment = makeSegment('img-1', 'Tumor');
    types().selectType(segment.typeId);

    store().deleteSegment(segment.id);

    expect(store().findEditTarget('img-1')).toBeUndefined();
    expect(types().getType(segment.typeId)).toBeDefined();
  });

  it('finds no target with nothing selected', () => {
    const segment = makeSegment('img-1', 'Tumor');
    types().selectType(segment.typeId);

    types().selectType(undefined);

    expect(store().findEditTarget('img-1')).toBeUndefined();
    expect(types().appearanceOf(segment.typeId).name).toBe('Tumor');
  });

  it('resolves an edit target to a record id', async () => {
    await seatImage('img-2');
    const segment = makeSegment('img-1', 'Tumor');
    types().selectType(segment.typeId);

    const resolved = store().resolveEditTarget('img-1');

    expect(resolved).toBe(segment.id);
    expect(types().selectedTypeId.value).toBe(segment.typeId);
  });

  it('resolves an edit target on an image with no records to a new id', () => {
    const resolved = store().resolveEditTarget('img-1');

    expect(typeof resolved).toBe('string');
    const { typeId } = store().getSegment(resolved);
    expect(types().appearanceOf(typeId).name).toBe('Segment 1');
    expect(types().selectedTypeId.value).toBe(typeId);
  });

  it('honors a preferred type without changing the selection', () => {
    const active = makeSegment('img-1', 'Tumor');
    const other = makeSegment('img-1', 'Node');
    types().selectType(active.typeId);

    const resolved = store().resolveEditTarget('img-1', other.typeId);

    expect(resolved).toBe(other.id);
    expect(types().selectedTypeId.value).toBe(active.typeId);
  });
});
