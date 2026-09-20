import { describe, expect, it } from 'vitest';

import {
  emptyExtent,
  extentSize,
  isEmptyExtent,
  markedExtent,
  type Extent3D,
} from '@/src/segmentation/geometry';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';

describe('emptyExtent', () => {
  it('is the pinned empty sentinel', () => {
    expect(emptyExtent()).toEqual([0, -1, 0, -1, 0, -1]);
  });

  it('returns a fresh extent per call', () => {
    const first = emptyExtent();
    first[1] = 10;

    expect(emptyExtent()).toEqual([0, -1, 0, -1, 0, -1]);
  });
});

describe('isEmptyExtent', () => {
  it('accepts the empty sentinel', () => {
    expect(isEmptyExtent(emptyExtent())).toBe(true);
  });

  it('rejects an extent covering a whole image', () => {
    expect(isEmptyExtent([0, 9, 0, 19, 0, 29])).toBe(false);
  });

  it('rejects a single voxel extent', () => {
    // vtk.js extents are inclusive, so min === max is one voxel, not empty.
    expect(isEmptyExtent([4, 4, 5, 5, 6, 6])).toBe(false);
  });

  it.each([
    ['i', [5, 4, 0, 9, 0, 9] as Extent3D],
    ['j', [0, 9, 5, 4, 0, 9] as Extent3D],
    ['k', [0, 9, 0, 9, 5, 4] as Extent3D],
  ])('is empty when the %s axis is inverted', (_axis, extent) => {
    expect(isEmptyExtent(extent)).toBe(true);
  });
});

// A binding's extent is the allocation: paint pads it on growth and an erase
// never shrinks it, so the box a segment occupies has to be read off the voxels.
describe('markedExtent', () => {
  // A mask bounded to `extent`, marked at each parent index in `marks`.
  const scalarsOf = (
    extent: Extent3D,
    marks: Array<[number, number, number]>
  ) => {
    const [si, sj, sk] = extentSize(extent);
    const scalars = new Uint8Array(si * sj * sk);
    marks.forEach(([i, j, k]) => {
      scalars[
        i - extent[0] + (j - extent[2]) * si + (k - extent[4]) * si * sj
      ] = SEGMENT_VALUE;
    });
    return scalars;
  };

  it('bounds the marked voxels, not the allocation they sit in', () => {
    const extent: Extent3D = [0, 5, 0, 5, 0, 5];
    const scalars = scalarsOf(extent, [
      [1, 2, 3],
      [4, 2, 3],
      [2, 5, 1],
    ]);

    expect(markedExtent(scalars, extent)).toEqual([1, 4, 2, 5, 1, 3]);
  });

  it('reads a single voxel as its own box', () => {
    const extent: Extent3D = [2, 4, 2, 4, 2, 4];
    const scalars = scalarsOf(extent, [[3, 3, 3]]);

    expect(markedExtent(scalars, extent)).toEqual([3, 3, 3, 3, 3, 3]);
  });

  it('reports an empty box for a mask holding nothing', () => {
    const extent: Extent3D = [0, 3, 0, 3, 0, 3];

    expect(isEmptyExtent(markedExtent(new Uint8Array(64), extent))).toBe(true);
  });

  it('reads a mask whose own origin is not the image origin', () => {
    const extent: Extent3D = [4, 6, 7, 9, 1, 2];
    const scalars = scalarsOf(extent, [
      [5, 8, 1],
      [6, 9, 2],
    ]);

    expect(markedExtent(scalars, extent)).toEqual([5, 6, 8, 9, 1, 2]);
  });
});
