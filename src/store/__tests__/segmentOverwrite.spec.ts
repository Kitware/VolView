import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

import {
  addSegment,
  bindingOf,
  extentOf,
  labelValueOf,
  maskValueAt,
  seatImage,
  seedVoxel,
  store,
  type Index3,
} from '@/src/store/__tests__/segmentMaskFixtures';

// ---------------------------------------------------------------------------
// Overwrite-all across N masks. One shared labelmap gave one label per voxel
// for free: writing a value there erased whatever value was in that voxel.
// With a mask per segment nothing erases anything, so the write paths clear
// the voxel in every OTHER mask of the same parent image themselves.
//
// The clearer is a factory because the sibling storage is resolved once per
// stroke, not once per voxel: `clear` is called for every voxel a brush writes.
// It takes PARENT index coordinates, the space extents are expressed in.
//
// Locks are deliberately not its business: a write path decides whether a voxel
// may be written at all, and only then clears the rest.
// ---------------------------------------------------------------------------

const DIMENSIONS: Index3 = [4, 4, 4];

const clearFor = (segmentId: string) => store().otherSegmentClearer(segmentId);

describe('clearing the other segments of an image', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1', { dimensions: DIMENSIONS });
  });

  it('clears the voxel in another segment’s mask', () => {
    const tumor = addSegment('img-1', 'Tumor');
    const node = addSegment('img-1', 'Node');
    seedVoxel(tumor, [1, 1, 1]);
    seedVoxel(node, [1, 1, 1]);

    clearFor(node)(1, 1, 1);

    expect(maskValueAt(tumor, [1, 1, 1])).toBe(0);
    expect(maskValueAt(node, [1, 1, 1])).toBe(labelValueOf(node));
  });

  it('clears the voxel in every other segment, not just the first', () => {
    const first = addSegment('img-1', 'First');
    const second = addSegment('img-1', 'Second');
    const painting = addSegment('img-1', 'Painting');
    seedVoxel(first, [1, 1, 1]);
    seedVoxel(second, [1, 1, 1]);
    seedVoxel(painting, [1, 1, 1]);

    clearFor(painting)(1, 1, 1);

    expect(maskValueAt(first, [1, 1, 1])).toBe(0);
    expect(maskValueAt(second, [1, 1, 1])).toBe(0);
  });

  it('leaves the other voxels of the segments it clears alone', () => {
    const tumor = addSegment('img-1', 'Tumor');
    const node = addSegment('img-1', 'Node');
    seedVoxel(tumor, [1, 1, 1]);
    store().segmentVoxels(tumor).ensureContains([1, 2, 1, 1, 1, 1]);
    seedVoxel(tumor, [2, 1, 1]);
    seedVoxel(node, [1, 1, 1]);

    clearFor(node)(1, 1, 1);

    expect(maskValueAt(tumor, [2, 1, 1])).toBe(labelValueOf(tumor));
  });

  it('does not grow a mask that does not reach the voxel', () => {
    const tumor = addSegment('img-1', 'Tumor');
    const node = addSegment('img-1', 'Node');
    seedVoxel(tumor, [1, 1, 1]);
    seedVoxel(node, [3, 3, 3]);
    const extent = extentOf(tumor);

    clearFor(node)(3, 3, 3);

    expect(extentOf(tumor)).toEqual(extent);
    expect(maskValueAt(tumor, [1, 1, 1])).toBe(labelValueOf(tumor));
  });

  it('allocates nothing for a segment that has no storage', () => {
    const tumor = addSegment('img-1', 'Tumor');
    const unbound = addSegment('img-1', 'Unbound');
    seedVoxel(tumor, [1, 1, 1]);

    clearFor(tumor)(1, 1, 1);

    expect(bindingOf(unbound)).toBeUndefined();
  });

  it('leaves the segments of another image alone', async () => {
    await seatImage('img-2', { dimensions: DIMENSIONS });
    const here = addSegment('img-1', 'Here');
    const there = addSegment('img-2', 'There');
    seedVoxel(here, [1, 1, 1]);
    seedVoxel(there, [1, 1, 1]);

    clearFor(here)(1, 1, 1);

    expect(maskValueAt(there, [1, 1, 1])).toBe(labelValueOf(there));
  });

  it('does nothing for a segment that has no neighbours', () => {
    const only = addSegment('img-1', 'Only');
    seedVoxel(only, [1, 1, 1]);

    expect(() => clearFor(only)(1, 1, 1)).not.toThrow();
    expect(maskValueAt(only, [1, 1, 1])).toBe(labelValueOf(only));
  });

  it('addresses voxels in parent index space, not in mask offsets', () => {
    const tumor = addSegment('img-1', 'Tumor');
    const node = addSegment('img-1', 'Node');
    // A mask that starts away from the origin: parent (3, 3, 3) is mask
    // (1, 1, 1) here, and mask (3, 3, 3) does not exist at all.
    seedVoxel(tumor, [2, 2, 2]);
    seedVoxel(tumor, [3, 3, 3]);
    seedVoxel(node, [3, 3, 3]);
    expect(extentOf(tumor)).toEqual([2, 3, 2, 3, 2, 3]);

    clearFor(node)(3, 3, 3);

    expect(maskValueAt(tumor, [3, 3, 3])).toBe(0);
    expect(maskValueAt(tumor, [2, 2, 2])).toBe(labelValueOf(tumor));
  });
});
