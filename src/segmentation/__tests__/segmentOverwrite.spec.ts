import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

import {
  addMask,
  bindingOf,
  extentOf,
  labelValueOf,
  maskValueAt,
  seatImage,
  seedVoxel,
  store,
  type Index3,
  lockSegment,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import type { Extent3D } from '@/src/segmentation/geometry';

// ---------------------------------------------------------------------------
// Overwrite-all across N masks. A mask per segment erases nothing on its own,
// so the write paths clear the voxel in every OTHER mask of the same parent
// image themselves.
//
// The claim is a factory because the sibling storage is resolved once per
// stroke, not once per voxel: it is made for every voxel a brush writes. It
// takes PARENT index coordinates, the space extents are expressed in, and is
// absent when no neighbour reaches the box the caller is about to walk.
//
// A locked segment is exempt. `locked` means not editable, and losing a voxel
// to a neighbour is an edit, so the claim is refused where a locked sibling
// holds the voxel and the writing segment goes around it. While overlap is
// allowed the claim takes from nobody and refuses nothing.
// ---------------------------------------------------------------------------

const DIMENSIONS: Index3 = [4, 4, 4];

const WHOLE_IMAGE: Extent3D = [0, 3, 0, 3, 0, 3];

/** The claim a paint or polygon gesture makes: aimed, so it takes the voxel. */
const clearFor = (maskId: string) => {
  const operation = store().voxelClaim(maskId, 'aimed', WHOLE_IMAGE);
  return (
    operation &&
    ((i: number, j: number, k: number) => {
      try {
        return operation.claim(i, j, k);
      } finally {
        operation.finish();
      }
    })
  );
};

function pairAt(index: Index3) {
  const tumor = addMask('img-1', 'Tumor');
  const node = addMask('img-1', 'Node');
  seedVoxel(tumor, index);
  seedVoxel(node, index);
  return { tumor, node };
}

/** A locked and an unlocked sibling of the segment about to claim. */
function siblingsOfPainting(lockedAt: Index3, unlockedAt: Index3) {
  const locked = addMask('img-1', 'Locked');
  const unlocked = addMask('img-1', 'Unlocked');
  const painting = addMask('img-1', 'Painting');
  seedVoxel(locked, lockedAt);
  seedVoxel(unlocked, unlockedAt);
  lockSegment(locked, true);
  return { locked, unlocked, painting };
}

const expectBothHold = (tumor: string, node: string) => {
  expect(maskValueAt(tumor, [1, 1, 1])).toBe(labelValueOf(tumor));
  expect(maskValueAt(node, [1, 1, 1])).toBe(labelValueOf(node));
};

describe('clearing the other segments of an image', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1', { dimensions: DIMENSIONS });
  });

  it('clears the voxel in another segment’s mask', () => {
    const { tumor, node } = pairAt([1, 1, 1]);

    clearFor(node)?.(1, 1, 1);

    expect(maskValueAt(tumor, [1, 1, 1])).toBe(0);
    expect(maskValueAt(node, [1, 1, 1])).toBe(labelValueOf(node));
  });

  it('clears the voxel in every other segment, not just the first', () => {
    const first = addMask('img-1', 'First');
    const second = addMask('img-1', 'Second');
    const painting = addMask('img-1', 'Painting');
    seedVoxel(first, [1, 1, 1]);
    seedVoxel(second, [1, 1, 1]);
    seedVoxel(painting, [1, 1, 1]);

    clearFor(painting)?.(1, 1, 1);

    expect(maskValueAt(first, [1, 1, 1])).toBe(0);
    expect(maskValueAt(second, [1, 1, 1])).toBe(0);
  });

  it('leaves the other voxels of the segments it clears alone', () => {
    const tumor = addMask('img-1', 'Tumor');
    const node = addMask('img-1', 'Node');
    seedVoxel(tumor, [1, 1, 1]);
    store().maskVoxels(tumor).ensureContains([1, 2, 1, 1, 1, 1]);
    seedVoxel(tumor, [2, 1, 1]);
    seedVoxel(node, [1, 1, 1]);

    clearFor(node)?.(1, 1, 1);

    expect(maskValueAt(tumor, [2, 1, 1])).toBe(labelValueOf(tumor));
  });

  it('does not grow a mask that does not reach the voxel', () => {
    const tumor = addMask('img-1', 'Tumor');
    const node = addMask('img-1', 'Node');
    seedVoxel(tumor, [1, 1, 1]);
    seedVoxel(node, [3, 3, 3]);
    const extent = extentOf(tumor);

    clearFor(node)?.(3, 3, 3);

    expect(extentOf(tumor)).toEqual(extent);
    expect(maskValueAt(tumor, [1, 1, 1])).toBe(labelValueOf(tumor));
  });

  it('does not clear an aliased offset outside a neighbour’s extent', () => {
    const tumor = addMask('img-1', 'Tumor');
    const node = addMask('img-1', 'Node');
    seedVoxel(tumor, [1, 2, 1]);
    store().maskVoxels(tumor).ensureContains([1, 2, 1, 2, 1, 2]);
    seedVoxel(node, [3, 1, 1]);

    clearFor(node)?.(3, 1, 1);

    expect(maskValueAt(tumor, [1, 2, 1])).toBe(labelValueOf(tumor));
  });

  it('allocates nothing for a segment that has no storage', () => {
    const tumor = addMask('img-1', 'Tumor');
    const unbound = addMask('img-1', 'Unbound');
    seedVoxel(tumor, [1, 1, 1]);

    clearFor(tumor)?.(1, 1, 1);

    expect(bindingOf(unbound)).toBeUndefined();
  });

  it('leaves the segments of another image alone', async () => {
    await seatImage('img-2', { dimensions: DIMENSIONS });
    const here = addMask('img-1', 'Here');
    const there = addMask('img-2', 'There');
    seedVoxel(here, [1, 1, 1]);
    seedVoxel(there, [1, 1, 1]);

    clearFor(here)?.(1, 1, 1);

    expect(maskValueAt(there, [1, 1, 1])).toBe(labelValueOf(there));
  });

  it('does nothing for a segment that has no neighbours', () => {
    const only = addMask('img-1', 'Only');
    seedVoxel(only, [1, 1, 1]);

    expect(() => clearFor(only)?.(1, 1, 1)).not.toThrow();
    expect(maskValueAt(only, [1, 1, 1])).toBe(labelValueOf(only));
  });

  it('refuses a voxel a locked segment holds and leaves it there', () => {
    const { tumor, node } = pairAt([1, 1, 1]);
    lockSegment(tumor, true);

    expect(clearFor(node)?.(1, 1, 1)).toBe(false);
    expectBothHold(tumor, node);
  });

  it('takes a voxel a locked sibling refuses from no other sibling', () => {
    const { locked, unlocked, painting } = siblingsOfPainting(
      [1, 1, 1],
      [1, 1, 1]
    );

    expect(clearFor(painting)?.(1, 1, 1)).toBe(false);
    expectBothHold(locked, unlocked);
  });

  it('clears an unlocked sibling beside a locked one that does not hold the voxel', () => {
    const { locked, unlocked, painting } = siblingsOfPainting(
      [1, 1, 2],
      [1, 1, 1]
    );

    expect(clearFor(painting)?.(1, 1, 1)).toBe(true);
    expect(maskValueAt(unlocked, [1, 1, 1])).toBe(0);
    expect(maskValueAt(locked, [1, 1, 2])).toBe(labelValueOf(locked));
  });

  it('reads the locks once, when the clearer is made', () => {
    const { tumor, node } = pairAt([1, 1, 1]);
    lockSegment(tumor, true);
    const clear = clearFor(node);
    lockSegment(tumor, false);

    // A lock lifted mid-stroke takes effect on the next stroke.
    expect(clear?.(1, 1, 1)).toBe(false);
    expectBothHold(tumor, node);
  });

  it('takes from no sibling, locked or not, while overlap is allowed', () => {
    const { locked, unlocked, painting } = siblingsOfPainting(
      [1, 1, 1],
      [1, 1, 1]
    );
    store().allowOverlap = true;

    expect(clearFor(painting)?.(1, 1, 1) ?? true).toBe(true);
    expectBothHold(locked, unlocked);
  });

  it('addresses voxels in parent index space, not in mask offsets', () => {
    const tumor = addMask('img-1', 'Tumor');
    const node = addMask('img-1', 'Node');
    // A mask that starts away from the origin: parent (3, 3, 3) is mask
    // (1, 1, 1) here, and mask (3, 3, 3) does not exist at all.
    seedVoxel(tumor, [2, 2, 2]);
    seedVoxel(tumor, [3, 3, 3]);
    seedVoxel(node, [3, 3, 3]);
    expect(extentOf(tumor)).toEqual([2, 3, 2, 3, 2, 3]);

    clearFor(node)?.(3, 3, 3);

    expect(maskValueAt(tumor, [3, 3, 3])).toBe(0);
    expect(maskValueAt(tumor, [2, 2, 2])).toBe(labelValueOf(tumor));
  });
});
