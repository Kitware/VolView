import { describe, expect, it } from 'vitest';
import { measureOccupiedDepth } from '@/src/segmentation/measurements/occupiedDepth';
import { createThinRegionMask } from '@/src/enface/projectionMasks';
import {
  isPresentThicknessBelow,
  thicknessSliderMaximum,
} from '@/src/enface/thickness';

describe('occupied-depth threshold presentation', () => {
  it.each([
    [0.003872, 35, 135.52, false],
    [0.0039, 13, 50.7, false],
    [0.000511, 293, 149.723, false],
    [0.003872, 35, 135.520000000001, true],
    [0.0039, 13, 50.700000000001, true],
    [1e-18, 1, 1.1e-15, true],
    [0.003872, 35, 135.51, false],
    [0.003872, 0, 135.52, false],
    [0.003872, 35, 0, false],
  ] as const)(
    'preserves strict calibrated threshold %f * %i below %f',
    (spacing, count, threshold, highlighted) => {
      const field = {
        width: 3,
        height: 1,
        counts: new Uint32Array([count, 0, count]),
        known: new Uint8Array([1, 1, 0]),
        maximumCount: count,
      };
      expect(
        Array.from(createThinRegionMask(field, threshold, spacing * 1000))
      ).toEqual([Number(highlighted), 0, 0]);
    }
  );

  it('fits the slider above the known occupied maximum after slab clipping', () => {
    const values = new Uint8Array(24);
    for (const depth of [0, 1, 4, 5]) values[2 * depth] = 1;
    const input = {
      dimensions: [2, 6, 2],
      axis: 1 as const,
      first: 0,
      last: 5,
      mask: { values, dimensions: [2, 6, 2], extent: [0, 1, 0, 5, 0, 1] },
    };
    const full = measureOccupiedDepth(input);
    const clipped = measureOccupiedDepth({ ...input, first: 1, last: 4 });
    expect(thicknessSliderMaximum(full, 10.4)).toBe(41.7);
    expect(thicknessSliderMaximum(clipped, 10.4)).toBe(20.9);
    expect(
      isPresentThicknessBelow(41.6, thicknessSliderMaximum(full, 10.4))
    ).toBe(true);
    expect(thicknessSliderMaximum(null, 10.4)).toBe(1);
  });
});
