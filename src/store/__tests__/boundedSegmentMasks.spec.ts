import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

import { LABELMAP_MAX_VALUE } from '@/src/store/segmentGroups';
import type { Extent3D } from '@/src/types/segmentation';
import { isEmptyExtent } from '@/src/types/segmentation';
import {
  addSegment,
  extentOf,
  maskValueAt,
  parentImage,
  seatImage,
  seedVoxel,
  store,
  type Index3,
} from '@/src/store/__tests__/segmentMaskFixtures';

// ---------------------------------------------------------------------------
// Bounded per-segment masks. Storage is one mask per SEGMENT, sized to the
// region that segment actually covers, positioned in the parent image's index
// space by `binding.extent`. `ensureContains` is the only thing that allocates
// or grows it, and growth invalidates: scalars, dimensions and strides all
// change under a caller that cached them.
// ---------------------------------------------------------------------------

const DIMENSIONS: Index3 = [4, 4, 4];

const dimensionsOf = (segmentId: string) =>
  store().segmentVoxels(segmentId).image().getDimensions();

const extentSize = (extent: Extent3D) => [
  extent[1] - extent[0] + 1,
  extent[3] - extent[2] + 1,
  extent[5] - extent[4] + 1,
];

describe('bounded segment masks', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1', { dimensions: DIMENSIONS });
  });

  describe('materialize', () => {
    it('binds the segment to storage that covers nothing yet', () => {
      const segmentId = addSegment('img-1', 'Tumor');
      const voxels = store().segmentVoxels(segmentId);

      const binding = voxels.materialize();

      expect(isEmptyExtent(binding.extent)).toBe(true);
      expect(voxels.exists()).toBe(true);
      expect(voxels.scalars()).toHaveLength(0);
      expect(voxels.snapshot()).toHaveLength(0);
    });

    it('gives every segment of one image its own mask', () => {
      const tumor = addSegment('img-1', 'Tumor');
      const node = addSegment('img-1', 'Node');

      store().segmentVoxels(tumor).materialize();
      store().segmentVoxels(node).materialize();

      expect(store().segmentVoxels(node).image()).not.toBe(
        store().segmentVoxels(tumor).image()
      );
      expect(store().segmentVoxels(node).scalars()).not.toBe(
        store().segmentVoxels(tumor).scalars()
      );
    });

    it('keeps label values distinct among the segments of one image', () => {
      const values = ['A', 'B', 'C']
        .map((name) => addSegment('img-1', name))
        .map((segmentId) => store().segmentVoxels(segmentId).materialize())
        .map((binding) => binding.labelValue);

      expect(new Set(values).size).toBe(3);
      expect(values.every((value) => value > 0)).toBe(true);
    });

    it('is idempotent and keeps the same storage', () => {
      const segmentId = addSegment('img-1', 'Tumor');
      const first = store().segmentVoxels(segmentId).materialize();
      const image = store().segmentVoxels(segmentId).image();

      const second = store().segmentVoxels(segmentId).materialize();

      expect(second).toEqual(first);
      expect(store().segmentVoxels(segmentId).image()).toBe(image);
    });
  });

  describe('first growth', () => {
    it('allocates exactly the requested extent and reports the invalidation', () => {
      const segmentId = addSegment('img-1', 'Tumor');
      const voxels = store().segmentVoxels(segmentId);
      voxels.materialize();

      expect(voxels.ensureContains([1, 2, 1, 2, 0, 0])).toBe(true);

      expect(extentOf(segmentId)).toEqual([1, 2, 1, 2, 0, 0]);
      expect(dimensionsOf(segmentId)).toEqual([2, 2, 1]);
      expect(voxels.scalars()).toHaveLength(4);
      expect(Array.from(voxels.scalars())).toEqual([0, 0, 0, 0]);
    });

    it('sits on the parent grid, so a mask voxel is its parent voxel', async () => {
      await seatImage('img-2', {
        dimensions: DIMENSIONS,
        spacing: [2, 3, 4],
        origin: [10, 20, 30],
      });
      const segmentId = addSegment('img-2', 'Tumor');
      const voxels = store().segmentVoxels(segmentId);
      voxels.materialize();

      voxels.ensureContains([1, 2, 1, 2, 2, 3]);

      const parent = parentImage('img-2');
      const mask = voxels.image();
      expect(Array.from(mask.getSpacing())).toEqual(
        Array.from(parent.getSpacing())
      );
      expect(Array.from(mask.getDirection())).toEqual(
        Array.from(parent.getDirection())
      );
      // The mask's own origin is the world position of the parent voxel its
      // extent starts at, so world points resolve to the same voxel in both.
      expect(Array.from(mask.indexToWorld([0, 0, 0] as never))).toEqual(
        Array.from(parent.indexToWorld([1, 1, 2] as never))
      );
      expect(
        Array.from(mask.worldToIndex(parent.indexToWorld([2, 2, 3] as never)))
      ).toEqual([1, 1, 1]);
    });

    it('leaves empty storage empty for an empty extent', () => {
      const segmentId = addSegment('img-1', 'Tumor');
      const voxels = store().segmentVoxels(segmentId);
      voxels.materialize();

      expect(voxels.ensureContains([0, -1, 0, -1, 0, -1])).toBe(false);

      expect(isEmptyExtent(extentOf(segmentId)!)).toBe(true);
      expect(voxels.scalars()).toHaveLength(0);
    });

    it('refuses to allocate outside the parent image', () => {
      const segmentId = addSegment('img-1', 'Tumor');
      const voxels = store().segmentVoxels(segmentId);
      voxels.materialize();

      expect(() => voxels.ensureContains([0, 4, 0, 3, 0, 3])).toThrow();
      expect(() => voxels.ensureContains([-1, 3, 0, 3, 0, 3])).toThrow();
      expect(isEmptyExtent(extentOf(segmentId)!)).toBe(true);
    });
  });

  describe('later growth', () => {
    it('grows to the union of what it had and what it was asked for', () => {
      const segmentId = addSegment('img-1', 'Tumor');
      const voxels = store().segmentVoxels(segmentId);
      voxels.materialize();
      voxels.ensureContains([1, 1, 1, 1, 1, 1]);

      expect(voxels.ensureContains([2, 3, 0, 1, 1, 2])).toBe(true);

      expect(extentOf(segmentId)).toEqual([1, 3, 0, 1, 1, 2]);
      expect(dimensionsOf(segmentId)).toEqual(extentSize(extentOf(segmentId)!));
    });

    it('keeps the voxels it already had at the same parent indices', () => {
      const segmentId = addSegment('img-1', 'Tumor');
      seedVoxel(segmentId, [1, 1, 1]);
      const labelValue = store().segmentVoxels(segmentId).binding()!.labelValue;

      store().segmentVoxels(segmentId).ensureContains([1, 3, 1, 3, 1, 1]);

      expect(dimensionsOf(segmentId)).toEqual([3, 3, 1]);
      expect(maskValueAt(segmentId, [1, 1, 1])).toBe(labelValue);
      expect(maskValueAt(segmentId, [3, 3, 1])).toBe(0);
      expect(maskValueAt(segmentId, [2, 1, 1])).toBe(0);
    });

    it('grows downward, moving its origin and keeping its voxels', () => {
      const segmentId = addSegment('img-1', 'Tumor');
      seedVoxel(segmentId, [2, 2, 2]);
      const labelValue = store().segmentVoxels(segmentId).binding()!.labelValue;

      store().segmentVoxels(segmentId).ensureContains([0, 0, 0, 0, 0, 0]);

      expect(extentOf(segmentId)).toEqual([0, 2, 0, 2, 0, 2]);
      expect(maskValueAt(segmentId, [2, 2, 2])).toBe(labelValue);
      expect(maskValueAt(segmentId, [0, 0, 0])).toBe(0);
      const mask = store().segmentVoxels(segmentId).image();
      expect(Array.from(mask.indexToWorld([0, 0, 0] as never))).toEqual(
        Array.from(parentImage('img-1').indexToWorld([0, 0, 0] as never))
      );
    });

    it('does not reallocate for an extent it already covers', () => {
      const segmentId = addSegment('img-1', 'Tumor');
      const voxels = store().segmentVoxels(segmentId);
      voxels.materialize();
      voxels.ensureContains([1, 3, 1, 3, 0, 3]);
      const scalars = voxels.scalars();
      const modified = voxels.image().getMTime();

      expect(voxels.ensureContains([2, 2, 2, 2, 1, 1])).toBe(false);

      expect(voxels.scalars()).toBe(scalars);
      expect(voxels.image().getMTime()).toBe(modified);
      expect(extentOf(segmentId)).toEqual([1, 3, 1, 3, 0, 3]);
    });

    it('never shrinks', () => {
      const segmentId = addSegment('img-1', 'Tumor');
      const voxels = store().segmentVoxels(segmentId);
      voxels.materialize();
      voxels.ensureContains([1, 3, 1, 3, 0, 3]);

      voxels.ensureContains([2, 2, 2, 2, 2, 2]);
      voxels.ensureContains([0, -1, 0, -1, 0, -1]);

      expect(extentOf(segmentId)).toEqual([1, 3, 1, 3, 0, 3]);
    });

    it('leaves the mask alone when it refuses a growth', () => {
      const segmentId = addSegment('img-1', 'Tumor');
      seedVoxel(segmentId, [1, 1, 1]);
      const labelValue = store().segmentVoxels(segmentId).binding()!.labelValue;
      expect(extentOf(segmentId)).toEqual([1, 1, 1, 1, 1, 1]);
      const before = extentOf(segmentId)!;

      expect(() =>
        store().segmentVoxels(segmentId).ensureContains([1, 4, 1, 1, 1, 1])
      ).toThrow();

      expect(extentOf(segmentId)).toEqual(before);
      expect(maskValueAt(segmentId, [1, 1, 1])).toBe(labelValue);
    });
  });

  describe('invalidation', () => {
    it('replaces the scalars a caller captured before growing', () => {
      const segmentId = addSegment('img-1', 'Tumor');
      const voxels = store().segmentVoxels(segmentId);
      voxels.materialize();
      voxels.ensureContains([1, 1, 1, 1, 1, 1]);
      const captured = voxels.scalars();

      expect(voxels.ensureContains([1, 2, 1, 1, 1, 1])).toBe(true);

      expect(voxels.scalars()).not.toBe(captured);
      // A write through the stale buffer is not a write to the segment.
      captured[0] = 9;
      expect(maskValueAt(segmentId, [1, 1, 1])).toBe(0);
    });

    it('keeps the same vtk image so the actor bound to it survives growth', () => {
      const segmentId = addSegment('img-1', 'Tumor');
      const voxels = store().segmentVoxels(segmentId);
      voxels.materialize();
      const image = voxels.image();

      voxels.ensureContains([1, 2, 1, 2, 1, 2]);

      expect(voxels.image()).toBe(image);
      expect(image.getDimensions()).toEqual([2, 2, 2]);
    });
  });

  describe('label values', () => {
    it('gives every materialized segment of one image its own byte value', () => {
      const values = Array.from(
        { length: LABELMAP_MAX_VALUE },
        () =>
          store().segmentVoxels(addSegment('img-1')).materialize().labelValue
      );

      expect(new Set(values).size).toBe(LABELMAP_MAX_VALUE);
      expect(Math.min(...values)).toBe(1);
      expect(Math.max(...values)).toBe(LABELMAP_MAX_VALUE);
    });

    it('refuses to materialize past the values a mask byte can hold', () => {
      Array.from({ length: LABELMAP_MAX_VALUE }, () =>
        store().segmentVoxels(addSegment('img-1')).materialize()
      );
      const overflow = addSegment('img-1', 'One too many');

      expect(() => store().segmentVoxels(overflow).materialize()).toThrow(
        /at most 255 segments/
      );
      // Refused, not half-done: the segment is still unbound.
      expect(store().segmentVoxels(overflow).binding()).toBeUndefined();
    });

    it('leaves the values of another image alone', async () => {
      Array.from({ length: LABELMAP_MAX_VALUE }, () =>
        store().segmentVoxels(addSegment('img-1')).materialize()
      );
      await seatImage('img-2', { dimensions: DIMENSIONS });
      const other = addSegment('img-2');

      expect(store().segmentVoxels(other).materialize().labelValue).toBe(1);
    });
  });

  describe('isolation', () => {
    it('writes through one segment’s mask without touching another’s', () => {
      const tumor = addSegment('img-1', 'Tumor');
      const node = addSegment('img-1', 'Node');
      seedVoxel(tumor, [1, 1, 1]);
      seedVoxel(node, [2, 2, 2]);

      expect(maskValueAt(tumor, [2, 2, 2])).toBeUndefined();
      expect(maskValueAt(node, [1, 1, 1])).toBeUndefined();
      expect(maskValueAt(tumor, [1, 1, 1])).toBe(
        store().segmentVoxels(tumor).binding()!.labelValue
      );
      expect(maskValueAt(node, [2, 2, 2])).toBe(
        store().segmentVoxels(node).binding()!.labelValue
      );
    });

    it('releases a deleted segment’s mask and leaves its neighbour alone', () => {
      const tumor = addSegment('img-1', 'Tumor');
      const node = addSegment('img-1', 'Node');
      seedVoxel(tumor, [1, 1, 1]);
      seedVoxel(node, [2, 2, 2]);
      const nodeImage = store().segmentVoxels(node).image();

      store().deleteSegment(tumor);

      expect(store().segmentVoxels(node).image()).toBe(nodeImage);
      expect(maskValueAt(node, [2, 2, 2])).toBe(
        store().segmentVoxels(node).binding()!.labelValue
      );
      // The neighbour never held the deleted segment's voxels to begin with.
      expect(maskValueAt(node, [1, 1, 1])).toBeUndefined();
    });
  });
});
