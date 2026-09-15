import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

import { LABELMAP_MAX_VALUE } from '@/src/segmentation/store';
import type { Extent3D } from '@/src/segmentation/model';
import { isEmptyExtent } from '@/src/segmentation/model';
import {
  addMask,
  extentOf,
  maskValueAt,
  parentImage,
  seatImage,
  seedVoxel,
  store,
  type Index3,
  boundMasks,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';

// ---------------------------------------------------------------------------
// Bounded per-segment masks. Storage is one mask per SEGMENT, sized to the
// region that segment actually covers, positioned in the parent image's index
// space by `binding.extent`. `ensureContains` is the only thing that allocates
// or grows it, and growth invalidates: scalars, dimensions and strides all
// change under a caller that cached them.
// ---------------------------------------------------------------------------

const DIMENSIONS: Index3 = [4, 4, 4];

const dimensionsOf = (maskId: string) =>
  store().maskVoxels(maskId).image().getDimensions();

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
      const maskId = addMask('img-1', 'Tumor');
      const voxels = store().maskVoxels(maskId);

      const binding = voxels.materialize();

      expect(isEmptyExtent(binding.extent)).toBe(true);
      expect(voxels.exists()).toBe(true);
      expect(voxels.scalars()).toHaveLength(0);
      expect(voxels.snapshot()).toHaveLength(0);
    });

    it('gives every segment of one image its own mask', () => {
      const tumor = addMask('img-1', 'Tumor');
      const node = addMask('img-1', 'Node');

      store().maskVoxels(tumor).materialize();
      store().maskVoxels(node).materialize();

      expect(store().maskVoxels(node).image()).not.toBe(
        store().maskVoxels(tumor).image()
      );
      expect(store().maskVoxels(node).scalars()).not.toBe(
        store().maskVoxels(tumor).scalars()
      );
    });

    it('gives every segment of one image its own storage', () => {
      const buffers = ['A', 'B', 'C']
        .map((name) => addMask('img-1', name))
        .map((maskId) => store().maskVoxels(maskId).materialize().image);

      expect(new Set(buffers).size).toBe(3);
    });

    it('is idempotent and keeps the same storage', () => {
      const maskId = addMask('img-1', 'Tumor');
      const first = store().maskVoxels(maskId).materialize();
      const image = store().maskVoxels(maskId).image();

      const second = store().maskVoxels(maskId).materialize();

      expect(second).toEqual(first);
      expect(store().maskVoxels(maskId).image()).toBe(image);
    });
  });

  describe('first growth', () => {
    it('allocates exactly the requested extent and reports the invalidation', () => {
      const maskId = addMask('img-1', 'Tumor');
      const voxels = store().maskVoxels(maskId);
      voxels.materialize();

      expect(voxels.ensureContains([1, 2, 1, 2, 0, 0])).toBe(true);

      expect(extentOf(maskId)).toEqual([1, 2, 1, 2, 0, 0]);
      expect(dimensionsOf(maskId)).toEqual([2, 2, 1]);
      expect(voxels.scalars()).toHaveLength(4);
      expect(Array.from(voxels.scalars())).toEqual([0, 0, 0, 0]);
    });

    it('sits on the parent grid, so a mask voxel is its parent voxel', async () => {
      await seatImage('img-2', {
        dimensions: DIMENSIONS,
        spacing: [2, 3, 4],
        origin: [10, 20, 30],
      });
      const maskId = addMask('img-2', 'Tumor');
      const voxels = store().maskVoxels(maskId);
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
      const maskId = addMask('img-1', 'Tumor');
      const voxels = store().maskVoxels(maskId);
      voxels.materialize();

      expect(voxels.ensureContains([0, -1, 0, -1, 0, -1])).toBe(false);

      expect(isEmptyExtent(extentOf(maskId)!)).toBe(true);
      expect(voxels.scalars()).toHaveLength(0);
    });

    it('refuses to allocate outside the parent image', () => {
      const maskId = addMask('img-1', 'Tumor');
      const voxels = store().maskVoxels(maskId);
      voxels.materialize();

      expect(() => voxels.ensureContains([0, 4, 0, 3, 0, 3])).toThrow();
      expect(() => voxels.ensureContains([-1, 3, 0, 3, 0, 3])).toThrow();
      expect(isEmptyExtent(extentOf(maskId)!)).toBe(true);
    });
  });

  describe('later growth', () => {
    it('grows to the union of what it had and what it was asked for', () => {
      const maskId = addMask('img-1', 'Tumor');
      const voxels = store().maskVoxels(maskId);
      voxels.materialize();
      voxels.ensureContains([1, 1, 1, 1, 1, 1]);

      expect(voxels.ensureContains([2, 3, 0, 1, 1, 2])).toBe(true);

      expect(extentOf(maskId)).toEqual([1, 3, 0, 1, 1, 2]);
      expect(dimensionsOf(maskId)).toEqual(extentSize(extentOf(maskId)!));
    });

    it('keeps the voxels it already had at the same parent indices', () => {
      const maskId = addMask('img-1', 'Tumor');
      seedVoxel(maskId, [1, 1, 1]);

      store().maskVoxels(maskId).ensureContains([1, 3, 1, 3, 1, 1]);

      expect(dimensionsOf(maskId)).toEqual([3, 3, 1]);
      expect(maskValueAt(maskId, [1, 1, 1])).toBe(SEGMENT_VALUE);
      expect(maskValueAt(maskId, [3, 3, 1])).toBe(0);
      expect(maskValueAt(maskId, [2, 1, 1])).toBe(0);
    });

    it('grows downward, moving its origin and keeping its voxels', () => {
      const maskId = addMask('img-1', 'Tumor');
      seedVoxel(maskId, [2, 2, 2]);

      store().maskVoxels(maskId).ensureContains([0, 0, 0, 0, 0, 0]);

      expect(extentOf(maskId)).toEqual([0, 2, 0, 2, 0, 2]);
      expect(maskValueAt(maskId, [2, 2, 2])).toBe(SEGMENT_VALUE);
      expect(maskValueAt(maskId, [0, 0, 0])).toBe(0);
      const mask = store().maskVoxels(maskId).image();
      expect(Array.from(mask.indexToWorld([0, 0, 0] as never))).toEqual(
        Array.from(parentImage('img-1').indexToWorld([0, 0, 0] as never))
      );
    });

    it('does not reallocate for an extent it already covers', () => {
      const maskId = addMask('img-1', 'Tumor');
      const voxels = store().maskVoxels(maskId);
      voxels.materialize();
      voxels.ensureContains([1, 3, 1, 3, 0, 3]);
      const scalars = voxels.scalars();
      const modified = voxels.image().getMTime();

      expect(voxels.ensureContains([2, 2, 2, 2, 1, 1])).toBe(false);

      expect(voxels.scalars()).toBe(scalars);
      expect(voxels.image().getMTime()).toBe(modified);
      expect(extentOf(maskId)).toEqual([1, 3, 1, 3, 0, 3]);
    });

    it('never shrinks', () => {
      const maskId = addMask('img-1', 'Tumor');
      const voxels = store().maskVoxels(maskId);
      voxels.materialize();
      voxels.ensureContains([1, 3, 1, 3, 0, 3]);

      voxels.ensureContains([2, 2, 2, 2, 2, 2]);
      voxels.ensureContains([0, -1, 0, -1, 0, -1]);

      expect(extentOf(maskId)).toEqual([1, 3, 1, 3, 0, 3]);
    });

    it('leaves the mask alone when it refuses a growth', () => {
      const maskId = addMask('img-1', 'Tumor');
      seedVoxel(maskId, [1, 1, 1]);
      expect(extentOf(maskId)).toEqual([1, 1, 1, 1, 1, 1]);
      const before = extentOf(maskId)!;

      expect(() =>
        store().maskVoxels(maskId).ensureContains([1, 4, 1, 1, 1, 1])
      ).toThrow();

      expect(extentOf(maskId)).toEqual(before);
      expect(maskValueAt(maskId, [1, 1, 1])).toBe(SEGMENT_VALUE);
    });
  });

  describe('invalidation', () => {
    it('replaces the scalars a caller captured before growing', () => {
      const maskId = addMask('img-1', 'Tumor');
      const voxels = store().maskVoxels(maskId);
      voxels.materialize();
      voxels.ensureContains([1, 1, 1, 1, 1, 1]);
      const captured = voxels.scalars();

      expect(voxels.ensureContains([1, 2, 1, 1, 1, 1])).toBe(true);

      expect(voxels.scalars()).not.toBe(captured);
      // A write through the stale buffer is not a write to the segment.
      captured[0] = 9;
      expect(maskValueAt(maskId, [1, 1, 1])).toBe(0);
    });

    it('keeps the same vtk image so the actor bound to it survives growth', () => {
      const maskId = addMask('img-1', 'Tumor');
      const voxels = store().maskVoxels(maskId);
      voxels.materialize();
      const image = voxels.image();

      voxels.ensureContains([1, 2, 1, 2, 1, 2]);

      expect(voxels.image()).toBe(image);
      expect(image.getDimensions()).toEqual([2, 2, 2]);
    });
  });

  describe('label values', () => {
    // A mask holds one segment, so its bytes say claimed or not and nothing
    // is allocated against a per-image pool.
    it('marks every segment of one image with the same value', () => {
      const masks = Array.from({ length: 3 }, () => addMask('img-1'));
      masks.forEach((maskId) => {
        store().maskVoxels(maskId).materialize();
        seedVoxel(maskId, [1, 1, 1]);
      });

      expect(masks.map((maskId) => maskValueAt(maskId, [1, 1, 1]))).toEqual([
        SEGMENT_VALUE,
        SEGMENT_VALUE,
        SEGMENT_VALUE,
      ]);
    });

    // The one-byte cap bound an image's segments only because they shared a
    // buffer. It now binds a flattened export file, not the store.
    it('materializes past the values a mask byte can hold', () => {
      Array.from({ length: LABELMAP_MAX_VALUE }, () =>
        store().maskVoxels(addMask('img-1')).materialize()
      );
      const overflow = addMask('img-1', 'One too many');

      expect(() => store().maskVoxels(overflow).materialize()).not.toThrow();
      expect(store().maskVoxels(overflow).binding()).toBeDefined();
      expect(boundMasks()).toHaveLength(LABELMAP_MAX_VALUE + 1);
    });
  });

  describe('isolation', () => {
    it('writes through one segment’s mask without touching another’s', () => {
      const tumor = addMask('img-1', 'Tumor');
      const node = addMask('img-1', 'Node');
      seedVoxel(tumor, [1, 1, 1]);
      seedVoxel(node, [2, 2, 2]);

      expect(maskValueAt(tumor, [2, 2, 2])).toBeUndefined();
      expect(maskValueAt(node, [1, 1, 1])).toBeUndefined();
      expect(maskValueAt(tumor, [1, 1, 1])).toBe(SEGMENT_VALUE);
      expect(maskValueAt(node, [2, 2, 2])).toBe(SEGMENT_VALUE);
    });

    it('releases a deleted segment’s mask and leaves its neighbour alone', () => {
      const tumor = addMask('img-1', 'Tumor');
      const node = addMask('img-1', 'Node');
      seedVoxel(tumor, [1, 1, 1]);
      seedVoxel(node, [2, 2, 2]);
      const nodeImage = store().maskVoxels(node).image();

      store().deleteMask(tumor);

      expect(store().maskVoxels(node).image()).toBe(nodeImage);
      expect(maskValueAt(node, [2, 2, 2])).toBe(SEGMENT_VALUE);
      // The neighbour never held the deleted segment's voxels to begin with.
      expect(maskValueAt(node, [1, 1, 1])).toBeUndefined();
    });
  });
});
