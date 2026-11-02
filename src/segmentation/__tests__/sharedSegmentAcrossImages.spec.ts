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

const segments = () => useSegmentStore().segments;

const viewImage = async (id: string) => {
  useViewStore().setDataForAllViews(id);
  await nextTick();
};

const recordIdsOf = (imageId: string) =>
  store().getSegmentationForImage(imageId)?.order ?? [];

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

const copiedTumor = async () => {
  const source = segments().addSegment('img-1', { name: 'Tumor' });
  await viewImage('img-2');
  const copied = segments().findSegmentByName('img-2', 'Tumor')!.id;
  return { source, copied };
};

describe('independent segments across images', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
    await seatSpecImage('img-2');
    await viewImage('img-1');
  });

  it('offers copied definitions and selection without allocating masks', async () => {
    const { source, copied } = await copiedTumor();

    expect(copied).not.toBe(source);
    expect(segments().getSegment(copied)?.color).toEqual(
      segments().getSegment(source)?.color
    );
    expect(segments().selectedSegmentId('img-2')).toBe(copied);
    expect(recordIdsOf('img-2')).toEqual([]);

    await viewImage('img-1');

    expect(segments().selectedSegmentId('img-1')).toBe(source);
  });

  it('changes visibility, lock and name only on the edited image', async () => {
    const { source, copied } = await copiedTumor();
    const first = store().resolveEditTarget('img-1', source);
    const second = store().resolveEditTarget('img-2', copied);

    segments().updateSegment(copied, {
      name: 'Lesion',
      visible: false,
      locked: true,
    });

    expect(segments().appearanceOf(source)).toMatchObject({
      name: 'Tumor',
      visible: true,
      locked: false,
    });
    expect(store().isLocked(first)).toBe(false);
    expect(store().isLocked(second)).toBe(true);
  });

  it('deletes only the selected image segment and its masks and shapes', async () => {
    const { source, copied } = await copiedTumor();
    const first = store().resolveEditTarget('img-1', source);
    store().resolveEditTarget('img-2', copied);
    const polygons = usePolygonStore();
    const kept = polygons.addTool({ imageID: 'img-1', segmentId: source });
    const removed = polygons.addTool({ imageID: 'img-2', segmentId: copied });

    segments().deleteSegment(copied);

    expect(recordIdsOf('img-1')).toEqual([first]);
    expect(recordIdsOf('img-2')).toEqual([]);
    expect(polygons.toolByID[kept]).toBeDefined();
    expect(polygons.toolByID[removed]).toBeUndefined();
    await viewImage('img-2');
    expect(segments().segmentList('img-2')).toEqual([]);
  });

  it('places an annotation against the destination image selection', async () => {
    const { source, copied } = await copiedTumor();
    const polygons = usePolygonStore();

    const toolId = polygons.addTool({ imageID: 'img-2', placing: false });

    expect(polygons.toolByID[toolId].segmentId).toBe(copied);
    expect(polygons.toolByID[toolId].segmentId).not.toBe(source);
  });

  it('rasterizes the destination copy without changing source voxels', async () => {
    const { source, copied } = await copiedTumor();
    const origin = store().resolveEditTarget('img-1', source);
    store().ensureLabelmapBinding(origin);

    const { maskId } = rasterizeOn('img-2', copied);

    expect(maskId).not.toBe(origin);
    expect(maskValueAt(maskId!, [1, 1, 0])).toBe(SEGMENT_VALUE);
    expect(markedVoxels(origin)).toEqual([]);
    expect(recordIdsOf('img-1')).toEqual([origin]);
  });

  it('refuses a segment owned by a different image before creating a mask', async () => {
    const { source } = await copiedTumor();

    expect(() => rasterizeOn('img-2', source)).toThrow(
      'Segment belongs to another image'
    );
    expect(recordIdsOf('img-2')).toEqual([]);
  });
});
