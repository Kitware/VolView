import { describe, expect, it } from 'vitest';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

import vtkLabelMap from '@/src/vtk/LabelMap';
import {
  boundScalars,
  groupByLayer,
  masksIntersect,
  writeMaskInto,
  type BoundedScalars,
} from '@/src/store/segmentLayers';
import {
  extentSize,
  maskOffset,
  type Extent3D,
} from '@/src/types/segmentation';

// ---------------------------------------------------------------------------
// One labelmap file carries one label per voxel, so two segments that share a
// voxel cannot go in the same one. These are the two halves of getting them
// out: which masks may share a file, and how a mask is written into it.
// ---------------------------------------------------------------------------

type Index3 = [number, number, number];

const PARENT: Index3 = [4, 4, 4];

const parentOffset = (i: number, j: number, k: number) =>
  i + j * PARENT[0] + k * PARENT[0] * PARENT[1];

/** A mask bounded to `extent`, holding `value` at each named parent voxel. */
function maskOf(extent: Extent3D, marks: Index3[], value = 1) {
  const [ni, nj, nk] = extentSize(extent);
  const mask = vtkLabelMap.newInstance();
  mask.setDimensions(ni, nj, nk);
  mask.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: new Uint8Array(ni * nj * nk),
    })
  );

  const bounded = boundScalars(mask, extent)!;
  marks.forEach((mark) => {
    bounded.scalars[maskOffset(bounded, ...mark)] = value;
  });
  return bounded;
}

/** A single-voxel mask, the smallest thing that can collide with another. */
const voxelMask = (at: Index3, value?: number) =>
  maskOf([at[0], at[0], at[1], at[1], at[2], at[2]], [at], value);

const layersOf = (masks: Record<string, BoundedScalars | undefined>) =>
  groupByLayer(Object.keys(masks), (name) => masks[name]);

/**
 * A mask that counts how many voxels the intersection test reads from it. The
 * count is taken on the buffer itself, which is what the sweep indexes.
 */
function countingMask(bounded: BoundedScalars) {
  const reads = { count: 0 };
  const scalars = new Proxy(bounded.scalars, {
    get(target, key) {
      if (Number.isInteger(Number(key))) reads.count += 1;
      return Reflect.get(target, key);
    },
  });
  return { mask: { ...bounded, scalars }, reads };
}

describe('deciding which masks can share a file', () => {
  it('keeps two segments that hold no voxel in common in one group', () => {
    const groups = layersOf({
      tumor: voxelMask([1, 1, 1]),
      node: voxelMask([3, 3, 3]),
    });

    expect(groups).toEqual([['tumor', 'node']]);
  });

  it('splits two segments that hold the same voxel', () => {
    const groups = layersOf({
      tumor: voxelMask([1, 1, 1]),
      node: voxelMask([1, 1, 1]),
    });

    expect(groups).toEqual([['tumor'], ['node']]);
  });

  it('puts a third segment back in the first group it fits', () => {
    const names = ['tumor', 'node', 'vessel'];
    const groups = layersOf({
      tumor: voxelMask([1, 1, 1]),
      node: voxelMask([1, 1, 1]),
      vessel: voxelMask([3, 3, 3]),
    });

    expect(groups).toEqual([['tumor', 'vessel'], ['node']]);
    expect(
      names.map((name) => groups.findIndex((group) => group.includes(name)))
    ).toEqual([0, 1, 0]);
  });

  it('groups masks that touch without sharing a voxel', () => {
    const groups = layersOf({
      tumor: maskOf([0, 2, 0, 0, 0, 0], [[0, 0, 0]]),
      node: maskOf([0, 2, 0, 0, 0, 0], [[2, 0, 0]]),
    });

    expect(groups).toEqual([['tumor', 'node']]);
  });

  it('keeps a segment with no mask in the first group', () => {
    const groups = layersOf({
      tumor: voxelMask([1, 1, 1]),
      unbound: undefined,
      node: voxelMask([1, 1, 1]),
    });

    expect(groups).toEqual([['tumor', 'unbound'], ['node']]);
  });

  it('makes no group at all for nothing to export', () => {
    expect(layersOf({})).toEqual([]);
  });
});

describe('testing two masks for a shared voxel', () => {
  it('rejects masks whose boxes miss without reading a voxel', () => {
    const near = countingMask(voxelMask([0, 0, 0]));
    const far = countingMask(voxelMask([3, 3, 0]));

    expect(masksIntersect(near.mask, far.mask)).toBe(false);
    expect(near.reads.count).toBe(0);
    expect(far.reads.count).toBe(0);
  });

  it('reads the shared box when the boxes do meet', () => {
    const wide = countingMask(maskOf([0, 3, 0, 0, 0, 0], [[0, 0, 0]]));
    const other = countingMask(maskOf([1, 3, 0, 0, 0, 0], [[3, 0, 0]]));

    expect(masksIntersect(wide.mask, other.mask)).toBe(false);
    expect(wide.reads.count).toBeGreaterThan(0);
  });

  it('finds a voxel both masks hold', () => {
    const wide = maskOf([0, 3, 0, 0, 0, 0], [[2, 0, 0]]);
    const tall = maskOf([2, 2, 0, 2, 0, 0], [[2, 0, 0]]);

    expect(masksIntersect(wide, tall)).toBe(true);
  });

  // The pair below is the shape a stride mistake shows up in: two differently
  // sized boxes, a shared box of 6 by 3 by 2 with no two sides alike, and the
  // one voxel they share in its far corner. Testing two masks needs no parent,
  // so these reach past the one the rest of the file writes into.
  const STRIDE_WIDE: Extent3D = [0, 7, 0, 3, 0, 3];
  const STRIDE_NARROW: Extent3D = [1, 6, 1, 3, 2, 3];

  it('finds a shared voxel with each mask read at its own stride', () => {
    const wide = maskOf(STRIDE_WIDE, [[4, 3, 3]]);
    const narrow = maskOf(STRIDE_NARROW, [[4, 3, 3]]);

    expect(masksIntersect(wide, narrow)).toBe(true);
  });

  it('separates masks whose boxes meet but whose voxels never do', () => {
    const wide = maskOf(STRIDE_WIDE, [[4, 3, 3]]);
    const narrow = maskOf(STRIDE_NARROW, [
      [4, 3, 2],
      [3, 3, 3],
      [4, 2, 3],
    ]);

    expect(masksIntersect(wide, narrow)).toBe(false);
  });
});

describe('writing a mask into a parent-shaped buffer', () => {
  it('marks the mask’s voxels at their parent indices', () => {
    const values = new Uint8Array(PARENT[0] * PARENT[1] * PARENT[2]);

    writeMaskInto(values, PARENT, voxelMask([1, 2, 3], 7));

    expect(values[parentOffset(1, 2, 3)]).toBe(7);
    expect(Array.from(values).filter((value) => value !== 0)).toHaveLength(1);
  });

  it('leaves a voxel it does not claim as the buffer had it', () => {
    const values = new Uint8Array(PARENT[0] * PARENT[1] * PARENT[2]);

    writeMaskInto(values, PARENT, maskOf([1, 2, 1, 1, 1, 1], [[1, 1, 1]], 3));
    writeMaskInto(values, PARENT, maskOf([1, 2, 1, 1, 1, 1], [[2, 1, 1]], 5));

    expect(values[parentOffset(1, 1, 1)]).toBe(3);
    expect(values[parentOffset(2, 1, 1)]).toBe(5);
  });

  it('gives the voxel to the mask written last', () => {
    const values = new Uint8Array(PARENT[0] * PARENT[1] * PARENT[2]);

    writeMaskInto(values, PARENT, voxelMask([1, 1, 1], 3));
    writeMaskInto(values, PARENT, voxelMask([1, 1, 1], 5));

    expect(values[parentOffset(1, 1, 1)]).toBe(5);
  });
});
