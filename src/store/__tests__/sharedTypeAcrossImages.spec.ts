import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import { useSegmentTypeStore } from '@/src/store/segmentTypes';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { useViewStore } from '@/src/store/views';
import { resolveRasterizeTarget } from '@/src/components/tools/polygon/rasterizeTarget';

// ---------------------------------------------------------------------------
// One type, every image. The registry is independent of the viewed image, so
// switching images keeps the selection and an edit takes this image's record
// for the selected type. Nothing is cloned and no identity is matched by name.
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

const viewImage = async (id: string) => {
  useViewStore().setDataForAllViews(id);
  await nextTick();
};

const recordIdsOf = (imageId: string) =>
  store().getSegmentationForImage(imageId)?.order ?? [];

const nameOn = (imageId: string, recordId: string) =>
  types().appearanceOf(store().getSegment(recordId).typeId).name;

describe('one type across images', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1');
    await seatImage('img-2');
  });

  it('paints the same type on a second image without cloning it', () => {
    const typeId = types().addType({ name: 'Tumor' });

    const first = store().resolveEditTarget('img-1');
    const second = store().resolveEditTarget('img-2');

    expect(second).not.toBe(first);
    expect(store().getSegment(first).typeId).toBe(typeId);
    expect(store().getSegment(second).typeId).toBe(typeId);
    expect(types().typeList.value).toHaveLength(1);
  });

  it('shows a rename on every image at once', () => {
    const typeId = types().addType({ name: 'Tumor' });
    const first = store().resolveEditTarget('img-1');
    const second = store().resolveEditTarget('img-2');

    types().updateType(typeId, { name: 'Lesion' });

    expect(nameOn('img-1', first)).toBe('Lesion');
    expect(nameOn('img-2', second)).toBe('Lesion');
  });

  it('keeps the selection when the viewed image changes', async () => {
    const typeId = types().addType({ name: 'Tumor' });

    await viewImage('img-2');

    expect(types().selectedTypeId.value).toBe(typeId);
    expect(recordIdsOf('img-2')).toEqual([]);
  });

  it('reuses this image record on a second edit', () => {
    types().addType({ name: 'Tumor' });

    const first = store().resolveEditTarget('img-2');
    const second = store().resolveEditTarget('img-2');

    expect(second).toBe(first);
    expect(recordIdsOf('img-2')).toEqual([first]);
  });

  it('mints a type when the selected one was deleted', () => {
    const typeId = types().addType({ name: 'Tumor' });
    types().deleteType(typeId);

    const target = store().resolveEditTarget('img-2');

    expect(types().getType(typeId)).toBeUndefined();
    expect(store().getSegment(target).typeId).not.toBe(typeId);
    expect(nameOn('img-2', target)).toBe('Segment 1');
  });

  it('takes a reselected type as the one an edit lands in', () => {
    types().addType({ name: 'Tumor' });
    const node = types().addType({ name: 'Node' });
    types().updateType(node, { name: 'Renamed node' });

    const target = store().resolveEditTarget('img-2');

    expect(nameOn('img-2', target)).toBe('Renamed node');
  });

  it('hides and locks the type on every image at once', () => {
    const typeId = types().addType({ name: 'Tumor' });
    const first = store().resolveEditTarget('img-1');
    const second = store().resolveEditTarget('img-2');

    types().updateType(typeId, { visible: false, locked: true });

    // Both describe the thing, so a record cannot disagree with its type.
    [first, second].forEach((recordId) => {
      const appearance = types().appearanceOf(
        store().getSegment(recordId).typeId
      );
      expect(appearance.visible).toBe(false);
      expect(appearance.locked).toBe(true);
      expect(store().isLocked(recordId)).toBe(true);
    });
  });

  it('deletes the type on every image at once', () => {
    const typeId = types().addType({ name: 'Tumor' });
    store().resolveEditTarget('img-1');
    store().resolveEditTarget('img-2');

    types().deleteType(typeId);

    expect(recordIdsOf('img-1')).toEqual([]);
    expect(recordIdsOf('img-2')).toEqual([]);
  });
});

describe('placing and rasterizing on another image', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1');
    await seatImage('img-2');
    await viewImage('img-1');
  });

  it('places an annotation on another image against the selected type', async () => {
    const typeId = types().addType({ name: 'Tumor' });
    const polygons = usePolygonStore();

    await viewImage('img-2');
    const toolId = polygons.addTool({ imageID: 'img-2', placing: false });

    expect(polygons.toolByID[toolId].typeId).toBe(typeId);
    expect(types().selectedTypeId.value).toBe(typeId);
  });

  it('shares the selection with the other delineation tools', () => {
    const typeId = useRectangleStore().types.addType({ name: 'Tumor' });

    expect(usePolygonStore().types.selectedTypeId.value).toBe(typeId);
    expect(useSegmentTypeStore().types.selectedTypeId.value).toBe(typeId);
  });

  it('rasterizes into this image record for the selected type', async () => {
    const typeId = types().addType({ name: 'Tumor' });
    types().updateType(typeId, { name: 'Lesion' });
    const origin = store().resolveEditTarget('img-1');

    await viewImage('img-2');
    const target = resolveRasterizeTarget('img-2', '')!;

    expect(target.typeId).toBe(typeId);
    expect(nameOn('img-2', target.segmentId)).toBe('Lesion');
    expect(recordIdsOf('img-2')).toEqual([target.segmentId]);
    expect(recordIdsOf('img-1')).toEqual([origin]);
  });

  it('never rasterizes into the other image mask', async () => {
    types().addType({ name: 'Tumor' });
    const origin = store().resolveEditTarget('img-1');
    store().ensureLabelmapBinding(origin);

    await viewImage('img-2');
    const target = resolveRasterizeTarget('img-2', '')!;

    expect(target.segmentId).not.toBe(origin);
    expect(target.artifactId).not.toBe(
      store().getSegment(origin).representations.labelmap!.artifactId
    );
  });
});
