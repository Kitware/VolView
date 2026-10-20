import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { disposePinia } from 'pinia';
import { nextTick } from 'vue';

import { useImageStatsStore } from '@/src/store/image-stats';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { useViewStore } from '@/src/store/views';
import {
  activateAppPinia,
  addMask,
  markedVoxels,
  parentImage,
  seatImage,
  selectSegment,
  viewImage,
  type Index3,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';

const CENTER: Index3 = [4, 4, 4];
const IMAGE_DIMENSIONS: Index3 = [9, 9, 70];
const SLICE_AXES = [0, 1, 2] as const;

const paintAt = (imageId: string, axis: 0 | 1 | 2, center = CENTER) => {
  const maskId = addMask(imageId, `Plane ${axis}`);
  selectSegment(maskId);
  const paint = usePaintToolStore();
  paint.setSliceAxis(axis, imageId);
  const worldPoint = parentImage(imageId).indexToWorld(center);
  paint.startStroke(worldPoint, axis, imageId);
  paint.endStroke(worldPoint, axis, imageId);
  return markedVoxels(maskId)!;
};

const paintAtCenter = (axis: 0 | 1 | 2, size: number) => {
  usePaintToolStore().setBrushSize(size);
  return paintAt('image', axis);
};

const paintedBounds = (painted: number[][]) =>
  CENTER.flatMap((_, coordinate) => [
    Math.min(...painted.map((voxel) => voxel[coordinate])),
    Math.max(...painted.map((voxel) => voxel[coordinate])),
  ]);

describe('brush size on the image grid', () => {
  let pinia: ReturnType<typeof activateAppPinia>;

  beforeEach(() => {
    pinia = activateAppPinia();
    useImageStatsStore().stats.image = {
      scalarMin: 0,
      scalarMax: 0,
      autoRangeValues: {},
    };
  });

  afterEach(() => {
    disposePinia(pinia);
  });

  it('paints exactly the selected voxel at size 1 in every plane', async () => {
    await viewImage('image', {
      dimensions: IMAGE_DIMENSIONS,
      spacing: [0.379, 0.379, 1.5],
    });

    for (const axis of SLICE_AXES) {
      expect(paintAtCenter(axis, 1), `slice axis ${axis}`).toEqual([
        [...CENTER, SEGMENT_VALUE],
      ]);
    }
  });

  it.each([
    { spacing: [0.1, 0.7, 0.7], expected: [[4, 4, 4]] },
    { spacing: [1, 7, 7], expected: [[4, 4, 4]] },
    {
      spacing: [0.1000001, 0.7, 0.7],
      expected: [
        [4, 4, 4],
        [4, 5, 4],
        [4, 4, 5],
        [4, 5, 5],
      ],
    },
  ])(
    'preserves voxel boundaries with spacing $spacing',
    async ({ spacing, expected }) => {
      await viewImage('image', {
        dimensions: IMAGE_DIMENSIONS,
        spacing: spacing as Index3,
      });

      expect(paintAtCenter(0, 7)).toEqual(
        expected.map((voxel) => [...voxel, SEGMENT_VALUE])
      );
    }
  );

  it('keeps a larger brush at the finest voxel scale when changing planes', async () => {
    await viewImage('image', {
      dimensions: IMAGE_DIMENSIONS,
      spacing: [0.25, 0.5, 1],
    });

    const expectedBounds = [
      [4, 4, 3, 5, 4, 5],
      [2, 6, 4, 4, 4, 5],
      [2, 6, 3, 5, 4, 4],
    ];

    for (const axis of SLICE_AXES) {
      expect(
        paintedBounds(paintAtCenter(axis, 5)),
        `slice axis ${axis}`
      ).toEqual(expectedBounds[axis]);
    }
  });

  it('initializes the default brush footprint when activating the tool', async () => {
    await viewImage('image', { dimensions: IMAGE_DIMENSIONS });
    const maskId = addMask('image');
    selectSegment(maskId);
    const paint = usePaintToolStore();

    paint.activateTool();
    paint.startStroke(CENTER, 2, 'image');
    paint.endStroke(CENTER, 2, 'image');

    expect(paintedBounds(markedVoxels(maskId)!)).toEqual([3, 6, 3, 6, 4, 4]);
  });

  it('keeps the chosen footprint when the active view has no image', async () => {
    await viewImage('image', { dimensions: IMAGE_DIMENSIONS });
    usePaintToolStore().setBrushSize(3);

    const views = useViewStore();
    const emptyView = views.viewIDs.find((id) => id !== views.activeView)!;
    views.setDataForView(emptyView, undefined);
    views.setActiveView(emptyView);
    await nextTick();

    expect(paintAt('image', 2)).toEqual([
      [4, 3, 4, SEGMENT_VALUE],
      [3, 4, 4, SEGMENT_VALUE],
      [4, 4, 4, SEGMENT_VALUE],
      [5, 4, 4, SEGMENT_VALUE],
      [4, 5, 4, SEGMENT_VALUE],
    ]);
  });

  it('fits a smaller image without changing the footprint on the active image', async () => {
    await viewImage('image', { dimensions: IMAGE_DIMENSIONS });
    useImageStatsStore().stats.small = {
      scalarMin: 0,
      scalarMax: 0,
      autoRangeValues: {},
    };
    await seatImage('small', { dimensions: [3, 3, 21] });
    usePaintToolStore().setBrushSize(7);

    expect(paintAt('small', 2, [1, 1, 1])).toEqual([
      [1, 0, 1, SEGMENT_VALUE],
      [0, 1, 1, SEGMENT_VALUE],
      [1, 1, 1, SEGMENT_VALUE],
      [2, 1, 1, SEGMENT_VALUE],
      [1, 2, 1, SEGMENT_VALUE],
    ]);
    expect(paintedBounds(paintAt('image', 2))).toEqual([1, 7, 1, 7, 4, 4]);
  });
});
