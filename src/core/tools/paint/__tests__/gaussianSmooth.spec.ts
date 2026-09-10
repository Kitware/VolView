import { describe, it, expect } from 'vitest';
import { fullExtent, type Extent3D } from '@/src/types/segmentation';
import { gaussianSmoothLabelMapWorker } from '../gaussianSmooth.worker';

const LABEL = 3;
type Dims = [number, number, number];

/** Reconstructs the whole parent, including growth outside the input mask. */
function smooth(
  data: Uint8Array,
  dimensions: Dims,
  maskExtent: Extent3D = fullExtent(dimensions),
  parentDimensions: Dims = dimensions
) {
  const { scalars, extent } = gaussianSmoothLabelMapWorker({
    data,
    dimensions,
    spacing: [1, 1, 1],
    maskExtent,
    parentDimensions,
    params: { sigma: 1, label: LABEL },
  });
  const [pi, pj, pk] = parentDimensions;
  const parent = new Uint8Array(pi * pj * pk);
  let offset = 0;
  for (let k = extent[4]; k <= extent[5]; k += 1) {
    for (let j = extent[2]; j <= extent[3]; j += 1) {
      for (let i = extent[0]; i <= extent[1]; i += 1) {
        parent[i + pi * (j + pj * k)] = scalars[offset++];
      }
    }
  }
  return parent;
}

function boxInParent(extent: Extent3D, dimensions: Dims) {
  const [pi, pj, pk] = dimensions;
  const parent = new Uint8Array(pi * pj * pk);
  for (let k = extent[4]; k <= extent[5]; k += 1) {
    for (let j = extent[2]; j <= extent[3]; j += 1) {
      for (let i = extent[0]; i <= extent[1]; i += 1) {
        parent[i + pi * (j + pj * k)] = LABEL;
      }
    }
  }
  return parent;
}

describe('gaussianSmoothLabelMapWorker', () => {
  it('smooths an isolated voxel away even when the mask is that one voxel', () => {
    const smoothed = smooth(
      new Uint8Array([LABEL]),
      [1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [3, 3, 3]
    );
    expect(smoothed.every((value) => value === 0)).toBe(true);
  });

  it.each([
    [2, 4, 2, 4, 2, 4],
    [1, 3, 1, 3, 1, 3],
    [0, 2, 2, 4, 2, 4],
    [1, 4, 1, 4, 1, 4],
    [4, 7, 4, 7, 4, 7],
  ] as Extent3D[])(
    'preserves the full-parent output for a tight mask at [%i, %i, %i, %i, %i, %i]',
    (...extent) => {
      const parentDimensions: Dims = [9, 9, 9];
      const dimensions: Dims = [
        extent[1] - extent[0] + 1,
        extent[3] - extent[2] + 1,
        extent[5] - extent[4] + 1,
      ];
      const data = new Uint8Array(
        dimensions[0] * dimensions[1] * dimensions[2]
      ).fill(LABEL);
      const croppedResult = smooth(data, dimensions, extent, parentDimensions);
      const parentResult = smooth(
        boxInParent(extent, parentDimensions),
        parentDimensions
      );
      expect(croppedResult).toEqual(parentResult);
    }
  );

  it('retains all 62 voxels when mirroring grows a box toward parent faces', () => {
    const smoothed = smooth(
      new Uint8Array(64).fill(LABEL),
      [4, 4, 4],
      [1, 4, 1, 4, 1, 4],
      [9, 9, 9]
    );
    expect(smoothed.filter((value) => value === LABEL)).toHaveLength(62);
    expect(smoothed[0 + 2 * 9 + 2 * 81]).toBe(LABEL);
  });

  it('erodes a cropped cube at its corners and keeps its centre', () => {
    const smoothed = smooth(
      new Uint8Array(27).fill(LABEL),
      [3, 3, 3],
      [1, 3, 1, 3, 1, 3],
      [5, 5, 5]
    );
    expect(smoothed[1 + 1 * 5 + 1 * 25]).toBe(0);
    expect(smoothed[2 + 2 * 5 + 2 * 25]).toBe(LABEL);
  });

  it('mirrors only at parent faces, not at the mask allocation', () => {
    const data = new Uint8Array(27).fill(LABEL);
    const againstFace = smooth(data, [3, 3, 3], [0, 2, 2, 4, 2, 4], [9, 9, 9]);
    const awayFromFace = smooth(data, [3, 3, 3], [1, 3, 2, 4, 2, 4], [9, 9, 9]);
    expect(againstFace[0 + 3 * 9 + 3 * 81]).toBe(LABEL);
    expect(awayFromFace[0 + 3 * 9 + 3 * 81]).toBe(0);
  });

  it('leaves a buffer with none of the label alone', () => {
    expect(Array.from(smooth(new Uint8Array([0, 1, 0, 1]), [4, 1, 1]))).toEqual(
      [0, 1, 0, 1]
    );
  });
});
