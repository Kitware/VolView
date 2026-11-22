import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type { Vector3 } from '@kitware/vtk.js/types';

import { useSegmentStore } from '@/src/segmentation/segments';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { rasterizePolygon } from '@/src/segmentation/editing/rasterizePolygon';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import {
  markedVoxels,
  maskValueAt,
  seatSpecImage,
  store,
  maskedSegmentIds,
  showImage,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

const segments = () => useSegmentStore().segments;

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
  await showImage('img-2');
  const copied = segments().addSegment('img-2', { name: 'Tumor' });
  return { source, copied };
};

describe('independent segments across images', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
    await seatSpecImage('img-2');
    await showImage('img-1');
  });

  it('offers copied definitions and selection without allocating masks', async () => {
    const { source, copied } = await copiedTumor();

    expect(copied).not.toBe(source);
    expect(segments().getSegment(copied)?.color).toEqual(
      segments().getSegment(source)?.color
    );
    expect(segments().selectedSegmentId('img-2')).toBe(copied);
    expect(maskedSegmentIds('img-2')).toEqual([]);

    await showImage('img-1');

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
    store().materializeMask(first);
    store().materializeMask(store().resolveEditTarget('img-2', copied));
    const polygons = usePolygonStore();
    polygons.addTool({ imageID: 'img-1', segmentId: source, placing: false });
    polygons.addTool({ imageID: 'img-2', segmentId: copied, placing: false });

    segments().deleteSegment(copied);

    expect(maskedSegmentIds('img-1')).toEqual([first]);
    expect(maskedSegmentIds('img-2')).toEqual([]);
    expect(polygons.serializeTools().tools).toEqual([
      expect.objectContaining({ imageID: 'img-1', segmentId: source }),
    ]);
    await showImage('img-2');
    expect(segments().segmentList('img-2')).toEqual([]);
  });

  it('places an annotation against the destination image selection', async () => {
    const { copied } = await copiedTumor();
    const polygons = usePolygonStore();

    const toolId = polygons.addTool({ imageID: 'img-2', placing: false });

    expect(polygons.serializeTools().tools).toEqual([
      expect.objectContaining({ id: toolId, segmentId: copied }),
    ]);
  });

  it('rasterizes the destination copy without changing source voxels', async () => {
    const { source, copied } = await copiedTumor();
    const origin = store().resolveEditTarget('img-1', source);
    store().materializeMask(origin);

    const { segmentId } = rasterizeOn('img-2', copied);

    expect(segmentId).toBe(copied);
    expect(maskValueAt(copied, [1, 1, 0])).toBe(SEGMENT_VALUE);
    expect(markedVoxels(origin)).toEqual([]);
    expect(maskedSegmentIds('img-1')).toEqual([origin]);
  });

  it('refuses a segment owned by a different image before creating a mask', async () => {
    const { source } = await copiedTumor();

    expect(() => rasterizeOn('img-2', source)).toThrow(
      'Segment belongs to another image'
    );
    expect(maskedSegmentIds('img-2')).toEqual([]);
  });
});
