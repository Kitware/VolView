import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import { useSegmentStore } from '@/src/store/segments';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { useViewStore } from '@/src/store/views';
import { resolveRasterizeTarget } from '@/src/components/tools/polygon/rasterizeTarget';

// ---------------------------------------------------------------------------
// One type, every image. The registry is independent of the viewed image, so
// switching images keeps the selection and an edit takes this image's mask
// for the selected type. Nothing is cloned and no identity is matched by name.
// ---------------------------------------------------------------------------

const DIMENSIONS = [4, 4, 2] as const;
const VOXEL_COUNT = DIMENSIONS[0] * DIMENSIONS[1] * DIMENSIONS[2];

const store = () => useSegmentationStore();
const segments = () => useSegmentStore().segments;

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

const nameOn = (imageId: string, maskId: string) =>
  segments().appearanceOf(store().getMask(maskId).segmentId).name;

describe('one type across images', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1');
    await seatImage('img-2');
  });

  it('paints the same type on a second image without cloning it', () => {
    const segmentId = segments().addSegment({ name: 'Tumor' });

    const first = store().resolveEditTarget('img-1');
    const second = store().resolveEditTarget('img-2');

    expect(second).not.toBe(first);
    expect(store().getMask(first).segmentId).toBe(segmentId);
    expect(store().getMask(second).segmentId).toBe(segmentId);
    expect(segments().segmentList.value).toHaveLength(1);
  });

  it('shows a rename on every image at once', () => {
    const segmentId = segments().addSegment({ name: 'Tumor' });
    const first = store().resolveEditTarget('img-1');
    const second = store().resolveEditTarget('img-2');

    segments().updateSegment(segmentId, { name: 'Lesion' });

    expect(nameOn('img-1', first)).toBe('Lesion');
    expect(nameOn('img-2', second)).toBe('Lesion');
  });

  it('keeps the selection when the viewed image changes', async () => {
    const segmentId = segments().addSegment({ name: 'Tumor' });

    await viewImage('img-2');

    expect(segments().selectedSegmentId.value).toBe(segmentId);
    expect(recordIdsOf('img-2')).toEqual([]);
  });

  it('reuses this image record on a second edit', () => {
    segments().addSegment({ name: 'Tumor' });

    const first = store().resolveEditTarget('img-2');
    const second = store().resolveEditTarget('img-2');

    expect(second).toBe(first);
    expect(recordIdsOf('img-2')).toEqual([first]);
  });

  it('mints a type when the selected one was deleted', () => {
    const segmentId = segments().addSegment({ name: 'Tumor' });
    segments().deleteSegment(segmentId);

    const target = store().resolveEditTarget('img-2');

    expect(segments().getSegment(segmentId)).toBeUndefined();
    expect(store().getMask(target).segmentId).not.toBe(segmentId);
    expect(nameOn('img-2', target)).toBe('Segment 1');
  });

  it('takes a reselected type as the one an edit lands in', () => {
    segments().addSegment({ name: 'Tumor' });
    const node = segments().addSegment({ name: 'Node' });
    segments().updateSegment(node, { name: 'Renamed node' });

    const target = store().resolveEditTarget('img-2');

    expect(nameOn('img-2', target)).toBe('Renamed node');
  });

  it('hides and locks the type on every image at once', () => {
    const segmentId = segments().addSegment({ name: 'Tumor' });
    const first = store().resolveEditTarget('img-1');
    const second = store().resolveEditTarget('img-2');

    segments().updateSegment(segmentId, { visible: false, locked: true });

    // Both describe the thing, so a record cannot disagree with its type.
    [first, second].forEach((maskId) => {
      const appearance = segments().appearanceOf(
        store().getMask(maskId).segmentId
      );
      expect(appearance.visible).toBe(false);
      expect(appearance.locked).toBe(true);
      expect(store().isLocked(maskId)).toBe(true);
    });
  });

  it('deletes the type on every image at once', () => {
    const segmentId = segments().addSegment({ name: 'Tumor' });
    store().resolveEditTarget('img-1');
    store().resolveEditTarget('img-2');

    segments().deleteSegment(segmentId);

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
    const segmentId = segments().addSegment({ name: 'Tumor' });
    const polygons = usePolygonStore();

    await viewImage('img-2');
    const toolId = polygons.addTool({ imageID: 'img-2', placing: false });

    expect(polygons.toolByID[toolId].segmentId).toBe(segmentId);
    expect(segments().selectedSegmentId.value).toBe(segmentId);
  });

  it('shares the selection with the other delineation tools', () => {
    const segmentId = useRectangleStore().segments.addSegment({
      name: 'Tumor',
    });

    expect(usePolygonStore().segments.selectedSegmentId.value).toBe(segmentId);
    expect(useSegmentStore().segments.selectedSegmentId.value).toBe(segmentId);
  });

  it('rasterizes into this image record for the selected type', async () => {
    const segmentId = segments().addSegment({ name: 'Tumor' });
    segments().updateSegment(segmentId, { name: 'Lesion' });
    const origin = store().resolveEditTarget('img-1');

    await viewImage('img-2');
    const target = resolveRasterizeTarget('img-2', '')!;

    expect(target.segmentId).toBe(segmentId);
    expect(nameOn('img-2', target.maskId)).toBe('Lesion');
    expect(recordIdsOf('img-2')).toEqual([target.maskId]);
    expect(recordIdsOf('img-1')).toEqual([origin]);
  });

  it('never rasterizes into the other image mask', async () => {
    segments().addSegment({ name: 'Tumor' });
    const origin = store().resolveEditTarget('img-1');
    store().ensureLabelmapBinding(origin);

    await viewImage('img-2');
    const target = resolveRasterizeTarget('img-2', '')!;

    expect(target.maskId).not.toBe(origin);
    expect(target.artifactId).not.toBe(
      store().getMask(origin).representations.labelmap!.artifactId
    );
  });
});
