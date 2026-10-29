import { describe, expect, it } from 'vitest';
import { histogram, histogramWindowRanges } from '@/src/utils/histogram';

describe('scalar image histograms', () => {
  it('keeps inclusive integer source bins and continuous image bins explicit', () => {
    const values = Float32Array.from([0, 0.25, 0.5, 0.75, 1]);
    expect(histogram(values, [0, 1], 4, 1)).toEqual([2, 2, 1, 0]);
    expect(histogram(values, [0, 1], 4, 0)).toEqual([1, 1, 1, 2]);
    const integers = Int16Array.from({ length: 1024 }, (_, i) => i % 512);
    expect(
      histogramWindowRanges(histogram(integers, [0, 511], 512, 1), [0, 511], 1)
    ).toEqual({
      FullRange: [0, 511],
      LowContrast: [5, 507],
      MediumContrast: [10, 502],
      HighContrast: [25, 487],
    });
  });

  it('excludes missing samples from bounds and percentile ranks', () => {
    const values = Array.from({ length: 1000 }, (_, i) => i * 0.0001);
    const padded = [...values, ...new Array(1000).fill(NaN)];
    expect(histogram(padded, [0, 0.0999], 512, 0)).toEqual(
      histogram(values, [0, 0.0999], 512, 0)
    );
    const ranges = histogramWindowRanges(
      histogram(padded, [0, 0.0999], 512, 0),
      [0, 0.0999],
      0
    );
    expect(ranges.HighContrast[0]).toBeGreaterThan(0.004);
    expect(ranges.HighContrast[1]).toBeLessThan(0.096);
  });

  it('keeps constants exact, reports empty images, and rejects occupied infinities', () => {
    expect(histogram([NaN, NaN], [0, 1], 2, 0)).toEqual([0, 0]);
    expect(histogram([], [0, 1], 2, 0)).toEqual([0, 0]);
    const constantBins = histogram([65535, NaN, 65535], [65535, 65535], 1, 0);
    expect(constantBins).toEqual([2]);
    expect(
      Object.values(histogramWindowRanges(constantBins, [65535, 65535], 0))
    ).toEqual(new Array(4).fill([65535, 65535]));
    expect(() => histogram([1, -Infinity], [0, 1], 512, 0)).toThrow(/finite/);
  });
});
