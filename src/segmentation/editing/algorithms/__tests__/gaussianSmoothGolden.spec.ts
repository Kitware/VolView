import { describe, it, expect } from 'vitest';
import { gaussianSmoothLabelMapWorker } from '@/src/segmentation/editing/algorithms/gaussianSmooth.worker';

// A byte-exact record of the filter's output. The rest of the smoothing suite
// asserts on shape properties, which a change in the arithmetic can satisfy
// while every voxel moves; this catches that.
//
// Each string is the volume row by row, '1' where the label survives. To
// refresh one after a deliberate change in behaviour, print
// `Array.from(smooth(...)).map((v) => (v ? 1 : 0)).join('')` and split it into
// rows of DIMENSIONS[0].

const LABEL = 3;
const DIMENSIONS: [number, number, number] = [9, 8, 7];

const SIGMA_0_6 =
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '011100100' +
  '011101100' +
  '011011100' +
  '000111100' +
  '001111100' +
  '000000000' +
  '000000000' +
  '000000000' +
  '011101100' +
  '011111100' +
  '011111100' +
  '001111100' +
  '011111100' +
  '000000000' +
  '000000000' +
  '000000000' +
  '011011100' +
  '011111100' +
  '001111100' +
  '011111100' +
  '011111000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000111100' +
  '001111100' +
  '011111100' +
  '011111000' +
  '011110000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '001111100' +
  '011111100' +
  '011111000' +
  '011110000' +
  '011100100' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000';

const SIGMA_1_0 =
  '000000000' +
  '000000000' +
  '000000000' +
  '000001000' +
  '000011000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '001111000' +
  '001111100' +
  '000111000' +
  '000010000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '001111000' +
  '011111100' +
  '011111100' +
  '001111100' +
  '001111000' +
  '000000000' +
  '000000000' +
  '000001000' +
  '001111100' +
  '011111100' +
  '011111100' +
  '011111100' +
  '001111000' +
  '000000000' +
  '000000000' +
  '000011000' +
  '000111000' +
  '001111100' +
  '011111100' +
  '011111000' +
  '001110000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000111000' +
  '001111000' +
  '011111000' +
  '011110000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000110000' +
  '001110000' +
  '001100000' +
  '000000000' +
  '000000000' +
  '000000000';

const ANISOTROPIC =
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '001100000' +
  '011110000' +
  '111111100' +
  '111111100' +
  '001111100' +
  '000111000' +
  '000000000' +
  '000000000' +
  '001000000' +
  '011111100' +
  '111111100' +
  '011111100' +
  '001111100' +
  '001111000' +
  '000000000' +
  '000000000' +
  '000001000' +
  '000111100' +
  '001111100' +
  '011111100' +
  '011111100' +
  '011111000' +
  '000000000' +
  '000000000' +
  '000011000' +
  '000111100' +
  '001111100' +
  '011111100' +
  '111111000' +
  '011110000' +
  '000000000' +
  '000000000' +
  '000111000' +
  '001111100' +
  '011111100' +
  '111111000' +
  '111111000' +
  '011100000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000' +
  '000000000';
/** An asymmetric blob with a pitted interior and two lone corner voxels. */
const blob = () => {
  const [di, dj, dk] = DIMENSIONS;
  const data = new Uint8Array(di * dj * dk);
  const mark = (i: number, j: number, k: number) => {
    data[i + j * di + k * di * dj] = LABEL;
  };
  for (let k = 1; k <= 5; k += 1) {
    for (let j = 1; j <= 5; j += 1) {
      for (let i = 1; i <= 6; i += 1) {
        if ((i + j + k) % 7 !== 0) mark(i, j, k);
      }
    }
  }
  mark(8, 0, 0);
  mark(0, 7, 6);
  return data;
};

const smooth = (sigma: number, spacing: [number, number, number]) =>
  gaussianSmoothLabelMapWorker({
    data: blob(),
    dimensions: DIMENSIONS,
    spacing,
    maskExtent: [0, 8, 0, 7, 0, 6],
    parentDimensions: DIMENSIONS,
    params: { sigma, label: LABEL },
  }).scalars;

const asBits = (output: ArrayLike<number>) =>
  Array.from(output, (value) => (value ? '1' : '0')).join('');

describe('gaussian smooth golden output', () => {
  it('matches byte for byte at a sigma below one voxel', () => {
    expect(asBits(smooth(0.6, [1, 1, 1]))).toBe(SIGMA_0_6);
  });

  it('matches byte for byte at a one-voxel sigma', () => {
    expect(asBits(smooth(1.0, [1, 1, 1]))).toBe(SIGMA_1_0);
  });

  it('matches byte for byte through anisotropic spacing', () => {
    expect(asBits(smooth(1.0, [1, 1, 3]))).toBe(ANISOTROPIC);
  });
});
