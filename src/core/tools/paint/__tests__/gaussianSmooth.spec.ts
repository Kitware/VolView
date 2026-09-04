import { describe, it, expect } from 'vitest';
import { gaussianSmoothLabelMapWorker } from '../gaussianSmooth.worker';

const LABEL = 3;
const SPACING: [number, number, number] = [1, 1, 1];

type Dims = [number, number, number];
type Box = [[number, number], [number, number], [number, number]];

const smooth = (
  data: Uint8Array,
  dimensions: Dims,
  sigma: number,
  label = LABEL,
  maskExtent: [number, number, number, number, number, number] = [
    0,
    dimensions[0] - 1,
    0,
    dimensions[1] - 1,
    0,
    dimensions[2] - 1,
  ],
  parentDimensions: Dims = dimensions
) =>
  gaussianSmoothLabelMapWorker({
    data,
    dimensions,
    spacing: SPACING,
    maskExtent,
    parentDimensions,
    params: { sigma, label },
  });

/** A solid box of `label` inside an otherwise empty buffer. */
function withBox(dimensions: Dims, box: Box, label = LABEL) {
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

const filledGrid = (dimensions: Dims, label = LABEL) =>
  new Uint8Array(dimensions[0] * dimensions[1] * dimensions[2]).fill(label);

/** The sub-block of `data` spanning `box`, in the same order as a mask crop. */
function crop(data: ArrayLike<number>, dimensions: Dims, box: Box) {
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

function smoothCroppedBox(box: Box) {
  const parentDimensions: Dims = [9, 9, 9];
  const dimensions: Dims = box.map(([from, to]) => to - from + 1) as Dims;
  const extent = box.flat() as [number, number, number, number, number, number];
  const parent = smooth(withBox(parentDimensions, box), parentDimensions, 1);
  const smoothed = smooth(
    filledGrid(dimensions),
    dimensions,
    1,
    LABEL,
    extent,
    parentDimensions
  );
  return {
    dimensions,
    parentDimensions,
    smoothed,
    parentCrop: crop(parent, parentDimensions, box),
  };
}

describe('gaussianSmoothLabelMapWorker', () => {
  it('smooths an isolated voxel away even when the mask is that one voxel', () => {
    const cropped = smooth(
      new Uint8Array([LABEL]),
      [1, 1, 1],
      1,
      LABEL,
      [1, 1, 1, 1, 1, 1],
      [3, 3, 3]
    );

    expect(Array.from(cropped)).toEqual([0]);
  });

  it('gives a cropped mask the result the whole parent grid gives', () => {
    const box: Box = [
      [2, 4],
      [2, 4],
      [2, 4],
    ];
    const { smoothed, parentCrop } = smoothCroppedBox(box);

    expect(Array.from(smoothed)).toEqual(parentCrop);
  });

  it('erodes the corners of a cropped cube', () => {
    const dimensions: Dims = [3, 3, 3];
    const smoothed = smooth(
      filledGrid(dimensions),
      dimensions,
      1,
      LABEL,
      [1, 3, 1, 3, 1, 3],
      [5, 5, 5]
    );

    // Corner voxels lose their neighbourhood on three sides; the centre keeps it.
    expect(smoothed[0]).toBe(0);
    expect(smoothed[13]).toBe(LABEL);
  });

  it('matches the whole parent grid where the segment touches its boundary', () => {
    const box: Box = [
      [0, 2],
      [2, 4],
      [2, 4],
    ];
    const { dimensions, parentDimensions, smoothed, parentCrop } =
      smoothCroppedBox(box);
    const zeroPadded = smooth(
      filledGrid(dimensions),
      dimensions,
      1,
      LABEL,
      [1, 3, 2, 4, 2, 4],
      parentDimensions
    );

    expect(Array.from(smoothed)).toEqual(parentCrop);
    expect(Array.from(smoothed)).not.toEqual(Array.from(zeroPadded));
  });

  it('leaves a buffer with none of the label alone', () => {
    const data = new Uint8Array([0, 1, 0, 1]);

    const smoothed = smooth(data, [4, 1, 1], 1);

    expect(Array.from(smoothed)).toEqual([0, 1, 0, 1]);
  });
});
