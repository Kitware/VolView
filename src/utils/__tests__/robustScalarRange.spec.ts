import { describe, expect, it } from 'vitest';
import { robustScalarRange } from '@/src/utils/robustScalarRange';

const range = (values: number[]) =>
  robustScalarRange(values, [Math.min(...values), Math.max(...values)]);

describe('robustScalarRange', () => {
  it('ignores a dominant background and clips outliers', () => {
    const values = [
      ...new Array(9000).fill(0),
      ...Array.from({ length: 1000 }, (_, index) => 100 + (index % 100)),
      1e6,
    ];
    expect(range(values)).toEqual([101, 199]);
  });

  it('ramps a binary mask up from its background', () => {
    expect(range([0, 0, 0, 1])).toEqual([0, 1]);
  });

  it('returns the full range of a constant image', () => {
    expect(robustScalarRange(new Float32Array(8).fill(3), [3, 3])).toEqual([
      3, 3,
    ]);
  });

  it('skips non-finite intensities', () => {
    expect(
      robustScalarRange([NaN, Infinity, 0, 0.25, 0.5, 0.75], [0, Infinity])
    ).toEqual([0.25, 0.75]);
  });

  it('falls back to the known range when sampling misses the foreground', () => {
    const values = new Uint8Array(2 ** 20);
    values[12345] = 200;
    expect(robustScalarRange(values, [0, 200])).toEqual([0, 200]);
  });
});
