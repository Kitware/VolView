import { describe, expect, it } from 'vitest';
import {
  histogram,
  histogramWindowRanges,
  piecewiseHistogram,
} from '@/src/utils/histogram';

describe('scalar image histograms', () => {
  it('keeps inclusive integer source bins', () => {
    const values = Float32Array.from([0, 0.25, 0.5, 0.75, 1]);
    expect(histogram(values, [0, 1], 4)).toEqual([2, 2, 1, 0]);
    const integers = Int16Array.from({ length: 1024 }, (_, i) => i % 512);
    expect(
      histogramWindowRanges(histogram(integers, [0, 511], 512), [0, 511])
    ).toEqual({
      FullRange: [0, 511],
      LowContrast: [5, 507],
      MediumContrast: [10, 502],
      HighContrast: [25, 487],
    });
  });

  it('excludes missing samples from bounds and percentile ranks', () => {
    const values = Array.from({ length: 1000 }, (_, i) => i);
    const padded = [...values, ...new Array(1000).fill(NaN)];
    expect(histogram(padded, [0, 999], 512)).toEqual(
      histogram(values, [0, 999], 512)
    );
    const ranges = histogramWindowRanges(
      histogram(padded, [0, 999], 512),
      [0, 999]
    );
    expect(ranges.HighContrast).toEqual([48.828125, 949.21875]);
  });

  it('keeps constants exact, reports empty images, and rejects occupied infinities', () => {
    expect(histogram([NaN, NaN], [0, 1], 2)).toEqual([0, 0]);
    expect(histogram([], [0, 1], 2)).toEqual([0, 0]);
    const constantBins = histogram([65535, NaN, 65535], [65535, 65535], 1);
    expect(constantBins).toEqual([2]);
    expect(
      Object.values(histogramWindowRanges(constantBins, [65535, 65535]))
    ).toEqual(new Array(4).fill([65535, 65535]));
    expect(() => histogram([1, -Infinity], [0, 1], 512)).toThrow(/finite/);
  });
});

describe('piecewiseHistogram', () => {
  it('uses one bin per level for integers narrower than the bin count', () => {
    const levels = Array.from({ length: 161 }, (_, index) => 20 + index);
    const counts = piecewiseHistogram(levels, [20, 180], 256, true);
    expect(counts).toHaveLength(161);
    expect(counts.every((count) => count > 0)).toBe(true);
    expect(piecewiseHistogram(levels, [20, 180], 256)).toHaveLength(256);
  });

  it('draws the two levels of a binary mask as separate peaks', () => {
    const mask = [...Array(9).fill(0), 1];
    expect(Array.from(piecewiseHistogram(mask, [0, 1], 256, true))).toEqual([
      9, 0, 1,
    ]);
  });

  it('bins only the given range and scales by the second-largest bin', () => {
    const values = [-5, 0, 0, 0, 0, 1, 1, 2, 3, 3, 4, 1e6, NaN];
    expect(Array.from(piecewiseHistogram(values, [0, 4], 5))).toEqual([
      2, 1, 0.5, 1, 0.5,
    ]);
  });

  it('is empty for a zero-width range', () => {
    expect(Array.from(piecewiseHistogram([3, 3], [3, 3], 4))).toEqual([
      0, 0, 0, 0,
    ]);
  });
});
