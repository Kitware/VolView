import { describe, expect, it } from 'vitest';
import {
  histogram,
  histogramWindowRanges,
  scalarRange,
} from '@/src/utils/histogram';
import { imageWindowRanges } from '@/src/utils/imageWindowing';

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
    expect(scalarRange(padded)).toEqual({
      min: 0,
      max: 0.0999,
      validCount: 1000,
    });
    expect(imageWindowRanges(padded)).toEqual(imageWindowRanges(values));
    expect(imageWindowRanges(padded)!.ranges.HighContrast[0]).toBeGreaterThan(
      0.004
    );
    expect(imageWindowRanges(padded)!.ranges.HighContrast[1]).toBeLessThan(
      0.096
    );
  });

  it('keeps constants exact, reports empty images, and rejects occupied infinities', () => {
    expect(imageWindowRanges([NaN, NaN])).toBeNull();
    expect(imageWindowRanges([])).toBeNull();
    const constant = imageWindowRanges([65535, NaN, 65535])!;
    expect(constant.validCount).toBe(2);
    expect(constant.level).toBe(65535);
    expect(constant.width).toBeGreaterThan(0);
    expect(Object.values(constant.ranges)).toEqual(
      new Array(4).fill([65535, 65535])
    );
    expect(() => imageWindowRanges([1, Infinity])).toThrow(/finite/);
    expect(() => histogram([1, -Infinity], [0, 1], 512, 0)).toThrow(/finite/);
  });
});
