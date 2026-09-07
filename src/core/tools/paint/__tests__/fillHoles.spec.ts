import { describe, it, expect } from 'vitest';
import { fillHoles } from '../fillHoles';

// Build a flat single-slice label map (axis 2, k=0) from a 2D grid.
// grid[j][i] maps to flat index i + j*dimI.
function flatFromGrid(grid: number[][]) {
  const dimI = grid[0].length;
  const dimJ = grid.length;
  const data = new Uint8Array(grid.flat());
  return { data, dimensions: [dimI, dimJ, 1] as [number, number, number] };
}

describe('fillHoles', () => {
  it('fills a background hole enclosed by a single segment', () => {
    const { data, dimensions } = flatFromGrid([
      [1, 1, 1],
      [1, 0, 1],
      [1, 1, 1],
    ]);
    const out = fillHoles({
      data,
      dimensions,
      axis: 2,
      sliceIndex: 0,
      label: 1,
    });
    expect(Array.from(out)).toEqual(
      Array.from(
        flatFromGrid([
          [1, 1, 1],
          [1, 1, 1],
          [1, 1, 1],
        ]).data
      )
    );
  });

  it('leaves border-connected background untouched', () => {
    const { data, dimensions } = flatFromGrid([
      [0, 1, 1],
      [1, 0, 1],
      [1, 1, 1],
    ]);
    const out = fillHoles({
      data,
      dimensions,
      axis: 2,
      sliceIndex: 0,
      label: 1,
    });
    // The top-left 0 reaches the border, so it stays 0; the center is enclosed.
    expect(Array.from(out)).toEqual(
      Array.from(
        flatFromGrid([
          [0, 1, 1],
          [1, 1, 1],
          [1, 1, 1],
        ]).data
      )
    );
  });

  it('does not mutate the input array', () => {
    const { data, dimensions } = flatFromGrid([
      [1, 1, 1],
      [1, 0, 1],
      [1, 1, 1],
    ]);
    const before = Array.from(data);
    fillHoles({ data, dimensions, axis: 2, sliceIndex: 0, label: 1 });
    expect(Array.from(data)).toEqual(before);
  });

  it('fills enclosed background but preserves encircled segments', () => {
    // 7 wide x 5 tall. Left block is a ring of 1 enclosing 0s and 2s; a stray
    // 2 sits outside the ring on the right border.
    const { data, dimensions } = flatFromGrid([
      [1, 1, 1, 1, 1, 0, 2],
      [1, 0, 2, 0, 1, 0, 0],
      [1, 2, 2, 2, 1, 0, 0],
      [1, 0, 2, 0, 1, 0, 0],
      [1, 1, 1, 1, 1, 0, 0],
    ]);
    const out = fillHoles({
      data,
      dimensions,
      axis: 2,
      sliceIndex: 0,
      label: 1,
    });
    // Enclosed background (0) becomes 1; the enclosed 2s stay 2.
    expect(Array.from(out)).toEqual(
      Array.from(
        flatFromGrid([
          [1, 1, 1, 1, 1, 0, 2],
          [1, 1, 2, 1, 1, 0, 0],
          [1, 2, 2, 2, 1, 0, 0],
          [1, 1, 2, 1, 1, 0, 0],
          [1, 1, 1, 1, 1, 0, 0],
        ]).data
      )
    );
  });

  it('does not override a segment it fully encircles', () => {
    // SegmentMask 1 forms a ring around segment 2 with a background gap between.
    const { data, dimensions } = flatFromGrid([
      [1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 2, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1],
    ]);
    const out = fillHoles({
      data,
      dimensions,
      axis: 2,
      sliceIndex: 0,
      label: 1,
    });
    // The background gap fills with 1; the encircled 2 is untouched.
    expect(Array.from(out)).toEqual(
      Array.from(
        flatFromGrid([
          [1, 1, 1, 1, 1],
          [1, 1, 1, 1, 1],
          [1, 1, 2, 1, 1],
          [1, 1, 1, 1, 1],
          [1, 1, 1, 1, 1],
        ]).data
      )
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

    const out = fillHoles({ data, dimensions, axis: 0, label: 1 });
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

    const out = fillHoles({
      data,
      dimensions,
      axis: 0,
      sliceIndex: 1,
      label: 1,
    });
    expect(out[holeOffset(0)]).toBe(0);
    expect(out[holeOffset(1)]).toBe(1);
    expect(out[holeOffset(2)]).toBe(0);
  });
});
