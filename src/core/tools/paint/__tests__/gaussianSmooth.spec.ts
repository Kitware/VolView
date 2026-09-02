import { describe, it, expect } from 'vitest';
import { gaussianSmoothLabelMapWorker } from '../gaussianSmooth.worker';

// Storage is one bounded mask per segment, cropped to the voxels that segment
// covers, so the buffer handed to the worker has foreground on every face.
// Those faces are crop edges, not the edge of anything real, and treating them
// as mirror planes would reflect foreground into every boundary sample.

const LABEL = 3;
const SPACING: [number, number, number] = [1, 1, 1];

type Dims = [number, number, number];

const smooth = (
  data: Uint8Array,
  dimensions: Dims,
  sigma: number,
  label = LABEL
) =>
  gaussianSmoothLabelMapWorker({
    data,
    dimensions,
    spacing: SPACING,
    params: { sigma, label },
  });

/** A solid box of `label` inside an otherwise empty buffer. */
function withBox(dimensions: Dims, box: [number, number][], label = LABEL) {
  const [di, dj, dk] = dimensions;
  const data = new Uint8Array(di * dj * dk);
  for (let k = box[2][0]; k <= box[2][1]; k += 1) {
    for (let j = box[1][0]; j <= box[1][1]; j += 1) {
      for (let i = box[0][0]; i <= box[0][1]; i += 1) {
        data[i + j * di + k * di * dj] = label;
      }
    }
  }
  return data;
}

/** The sub-block of `data` spanning `box`, in the same order as a mask crop. */
function crop(
  data: ArrayLike<number>,
  dimensions: Dims,
  box: [number, number][]
) {
  const [di, dj] = dimensions;
  const out: number[] = [];
  for (let k = box[2][0]; k <= box[2][1]; k += 1) {
    for (let j = box[1][0]; j <= box[1][1]; j += 1) {
      for (let i = box[0][0]; i <= box[0][1]; i += 1) {
        out.push(data[i + j * di + k * di * dj]);
      }
    }
  }
  return out;
}

describe('gaussianSmoothLabelMapWorker', () => {
  it('smooths an isolated voxel away even when the mask is that one voxel', () => {
    const cropped = smooth(new Uint8Array([LABEL]), [1, 1, 1], 1);

    expect(Array.from(cropped)).toEqual([0]);
  });

  it('gives a cropped mask the result the whole parent grid gives', () => {
    const box: [number, number][] = [
      [2, 4],
      [2, 4],
      [2, 4],
    ];
    const parentDims: Dims = [9, 9, 9];
    const parent = smooth(withBox(parentDims, box), parentDims, 1);

    const croppedDims: Dims = [3, 3, 3];
    const cropped = smooth(
      withBox(croppedDims, [
        [0, 2],
        [0, 2],
        [0, 2],
      ]),
      croppedDims,
      1
    );

    expect(Array.from(cropped)).toEqual(crop(parent, parentDims, box));
  });

  it('erodes the corners of a cropped cube', () => {
    const dimensions: Dims = [3, 3, 3];
    const smoothed = smooth(
      withBox(dimensions, [
        [0, 2],
        [0, 2],
        [0, 2],
      ]),
      dimensions,
      1
    );

    // Corner voxels lose their neighbourhood on three sides; the centre keeps it.
    expect(smoothed[0]).toBe(0);
    expect(smoothed[13]).toBe(LABEL);
  });

  it('leaves a buffer with none of the label alone', () => {
    const data = new Uint8Array([0, 1, 0, 1]);

    const smoothed = smooth(data, [4, 1, 1], 1);

    expect(Array.from(smoothed)).toEqual([0, 1, 0, 1]);
  });
});
