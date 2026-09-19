import { describe, it, expect } from 'vitest';
import { fillHoles } from '@/src/segmentation/editing/algorithms/fillHoles';
import { fillHolesWorker } from '@/src/segmentation/editing/algorithms/fillHoles.worker';

// Build a flat single-slice label map (axis 2, k=0) from a 2D grid.
// grid[j][i] maps to flat index i + j*dimI.
function flatFromGrid(grid: number[][]) {
  const dimI = grid[0].length;
  const dimJ = grid.length;
  const data = new Uint8Array(grid.flat());
  return { data, dimensions: [dimI, dimJ, 1] as [number, number, number] };
}

const fillAxialSlice = (
  data: Uint8Array,
  dimensions: [number, number, number]
) => fillHoles({ data, dimensions, axis: 2, sliceIndex: 0 }).out;

const flatOf = (grid: number[][]) => Array.from(flatFromGrid(grid).data);

describe('fillHoles', () => {
  it('fills a background hole enclosed by a single segment', () => {
    const { data, dimensions } = flatFromGrid([
      [1, 1, 1],
      [1, 0, 1],
      [1, 1, 1],
    ]);
    const out = fillAxialSlice(data, dimensions);
    expect(Array.from(out)).toEqual(
      flatOf([
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 1],
      ])
    );
  });

  it('leaves border-connected background untouched', () => {
    const { data, dimensions } = flatFromGrid([
      [0, 1, 1],
      [1, 0, 1],
      [1, 1, 1],
    ]);
    const out = fillAxialSlice(data, dimensions);
    // The top-left 0 reaches the border, so it stays 0; the center is enclosed.
    expect(Array.from(out)).toEqual(
      flatOf([
        [0, 1, 1],
        [1, 1, 1],
        [1, 1, 1],
      ])
    );
  });

  it('does not mutate the input array', () => {
    const { data, dimensions } = flatFromGrid([
      [1, 1, 1],
      [1, 0, 1],
      [1, 1, 1],
    ]);
    const before = Array.from(data);
    fillAxialSlice(data, dimensions);
    expect(Array.from(data)).toEqual(before);
  });

  it('fills enclosed holes while leaving disconnected foreground alone', () => {
    const { data, dimensions } = flatFromGrid([
      [1, 1, 1, 1, 1, 0, 1],
      [1, 0, 1, 0, 1, 0, 0],
      [1, 1, 1, 1, 1, 0, 0],
      [1, 0, 1, 0, 1, 0, 0],
      [1, 1, 1, 1, 1, 0, 0],
    ]);
    const out = fillAxialSlice(data, dimensions);
    expect(Array.from(out)).toEqual(
      flatOf([
        [1, 1, 1, 1, 1, 0, 1],
        [1, 1, 1, 1, 1, 0, 0],
        [1, 1, 1, 1, 1, 0, 0],
        [1, 1, 1, 1, 1, 0, 0],
        [1, 1, 1, 1, 1, 0, 0],
      ])
    );
  });

  it('fills the gap around an island', () => {
    const { data, dimensions } = flatFromGrid([
      [1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 1, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1],
    ]);
    const out = fillAxialSlice(data, dimensions);
    expect(Array.from(out)).toEqual(
      flatOf([
        [1, 1, 1, 1, 1],
        [1, 1, 1, 1, 1],
        [1, 1, 1, 1, 1],
        [1, 1, 1, 1, 1],
        [1, 1, 1, 1, 1],
      ])
    );
  });

  it('counts the voxels it filled', () => {
    const { data, dimensions } = flatFromGrid([
      [1, 1, 1, 1, 0],
      [1, 0, 1, 1, 0],
      [1, 0, 0, 1, 0],
      [1, 1, 1, 1, 0],
    ]);
    expect(fillHoles({ data, dimensions, axis: 2, sliceIndex: 0 }).filled).toBe(
      3
    );
  });

  it('whole-volume on a non-default axis fills every slice', () => {
    // dims [3,3,3], slicing along axis 0: each i-plane is the (j,k) plane.
    // Every i-plane is a ring of 1 around a 0 at (j=1, k=1).
    const dimensions: [number, number, number] = [3, 3, 3];
    const data = new Uint8Array(27).fill(1);
    const holeOffset = (i: number) => i + 1 * 3 + 1 * 9; // j=1, k=1
    for (let i = 0; i < 3; i += 1) data[holeOffset(i)] = 0;
    // A border voxel that must stay 0 (corner of the i=0 plane).
    data[0] = 0;

    const { out } = fillHoles({ data, dimensions, axis: 0 });
    for (let i = 0; i < 3; i += 1) {
      expect(out[holeOffset(i)]).toBe(1);
    }
    expect(out[0]).toBe(0);
  });

  it('only fills the requested slice when sliceIndex is given', () => {
    const dimensions: [number, number, number] = [3, 3, 3];
    const data = new Uint8Array(27).fill(1);
    const holeOffset = (i: number) => i + 1 * 3 + 1 * 9;
    for (let i = 0; i < 3; i += 1) data[holeOffset(i)] = 0;

    const { out } = fillHoles({
      data,
      dimensions,
      axis: 0,
      sliceIndex: 1,
    });
    expect(out[holeOffset(0)]).toBe(0);
    expect(out[holeOffset(1)]).toBe(1);
    expect(out[holeOffset(2)]).toBe(0);
  });
});

describe('fillHolesWorker', () => {
  const run = (grid: number[][]) =>
    fillHolesWorker({
      ...flatFromGrid(grid),
      axis: 2,
      sliceIndex: 0,
    });

  it('hands back nothing when no hole is enclosed', () => {
    // A process reads no result as "nothing to do", so the mask is not
    // rewritten and no preview opens between two identical states.
    expect(
      run([
        [1, 1, 1],
        [1, 0, 0],
        [1, 1, 1],
      ])
    ).toBeUndefined();
  });

  it('hands back the filled copy when a hole is filled', () => {
    const out = run([
      [1, 1, 1],
      [1, 0, 1],
      [1, 1, 1],
    ]);
    expect(Array.from(out ?? [])).toEqual(
      flatOf([
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 1],
      ])
    );
  });
});
