import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import type { Vector3 } from '@kitware/vtk.js/types';

import { useSegmentStore } from '@/src/segmentation/segments';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useViewStore } from '@/src/store/views';
import { rasterizePolygon } from '@/src/segmentation/editing/rasterizePolygon';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import {
  markedVoxels,
  maskValueAt,
  seatSpecImage,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

// ---------------------------------------------------------------------------
// One segment, every image. The registry is independent of the viewed image, so
// switching images keeps the selection and an edit takes this image's mask
// for the selected segment. Nothing is cloned and no identity is matched by name.
// ---------------------------------------------------------------------------

const segments = () => useSegmentStore().segments;

const viewImage = async (id: string) => {
  useViewStore().setDataForAllViews(id);
  await nextTick();
};

const recordIdsOf = (imageId: string) =>
  store().getSegmentationForImage(imageId)?.order ?? [];

const nameOf = (maskId: string) =>
  segments().appearanceOf(store().getMask(maskId).segmentId).name;

const SQUARE: Vector3[] = [
  [0, 0, 0],
  [2, 0, 0],
  [2, 2, 0],
  [0, 2, 0],
];

const rasterizeOn = (imageId: string, segmentId: string) =>
  rasterizePolygon({
    imageId,
    segmentId,
    points: SQUARE,
    slice: 0,
    viewAxis: 'Axial',
  });

describe('one segment across images', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
    await seatSpecImage('img-2');
  });

  it('keeps the selection when the viewed image changes', async () => {
    const segmentId = segments().addSegment({ name: 'Tumor' });

    await viewImage('img-2');

    expect(segments().selectedSegmentId.value).toBe(segmentId);
    expect(recordIdsOf('img-2')).toEqual([]);
  });

  it('hides and locks the segment on every image at once', () => {
    const segmentId = segments().addSegment({ name: 'Tumor' });
    const first = store().resolveEditTarget('img-1');
    const second = store().resolveEditTarget('img-2');

    segments().updateSegment(segmentId, { visible: false, locked: true });

    // Both describe the thing, so a record cannot disagree with its segment.
    [first, second].forEach((maskId) => {
      const appearance = segments().appearanceOf(
        store().getMask(maskId).segmentId
      );
      expect(appearance.visible).toBe(false);
      expect(appearance.locked).toBe(true);
      expect(store().isLocked(maskId)).toBe(true);
    });
  });

  it('deletes the segment on every image at once', () => {
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
    await seatSpecImage('img-1');
    await seatSpecImage('img-2');
    await viewImage('img-1');
  });

  it('places an annotation on another image against the selected segment', async () => {
    const segmentId = segments().addSegment({ name: 'Tumor' });
    const polygons = usePolygonStore();

    await viewImage('img-2');
    const toolId = polygons.addTool({ imageID: 'img-2', placing: false });

    expect(polygons.toolByID[toolId].segmentId).toBe(segmentId);
    expect(segments().selectedSegmentId.value).toBe(segmentId);
  });

  it("rasterizes into this image's record for the polygon's segment", async () => {
    const segmentId = segments().addSegment({ name: 'Tumor' });
    segments().updateSegment(segmentId, { name: 'Lesion' });
    const origin = store().resolveEditTarget('img-1');

    await viewImage('img-2');
    const result = rasterizeOn('img-2', segmentId);

    expect(result.segmentId).toBe(segmentId);
    expect(nameOf(result.maskId!)).toBe('Lesion');
    expect(recordIdsOf('img-2')).toEqual([result.maskId]);
    expect(recordIdsOf('img-1')).toEqual([origin]);
  });

  it('never rasterizes into the other image mask', async () => {
    const segmentId = segments().addSegment({ name: 'Tumor' });
    const origin = store().resolveEditTarget('img-1');
    store().ensureLabelmapBinding(origin);

    await viewImage('img-2');
    const { maskId } = rasterizeOn('img-2', segmentId);

    expect(maskId).not.toBe(origin);
    expect(maskValueAt(maskId!, [1, 1, 0])).toBe(SEGMENT_VALUE);
    expect(markedVoxels(origin)).toEqual([]);
  });
});
