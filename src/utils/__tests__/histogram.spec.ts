import { describe, expect, it } from 'vitest';
import { piecewiseHistogram } from '@/src/utils/histogram';

describe('opacity editor histograms', () => {
  it('keeps endpoint-centered editor bins and scales below the largest peak', () => {
    const ordinary = [0, 1, 1, 2, 2, 2, 3, 3, 3, 3, 4];
    expect(Array.from(piecewiseHistogram(ordinary, [0, 4], 5))).toAlmostEqual([
      1 / 3,
      2 / 3,
      1,
      4 / 3,
      1 / 3,
    ]);
    const fitted = ordinary.map((value) => Math.max(2, value));
    expect(Array.from(piecewiseHistogram(fitted, [2, 4], 5))).toAlmostEqual([
      1.5, 0, 1, 0, 0.25,
    ]);
  });
});
