import { describe, expect, it } from 'vitest';
import { mappingRangeSliders } from '@/src/utils/mappingRangeSliders';

const onGrid = (value: number, origin: number, step: number) =>
  Number.isInteger((value - origin) / step);

describe('mappingRangeSliders', () => {
  it.each([0.01, 0.78, 6095, 6095.5])(
    'lets Width shrink below the full width %s and keeps zero shift on the grid',
    (fullWidth) => {
      const { step, shift, width } = mappingRangeSliders(fullWidth);
      expect(step).toBeGreaterThan(0);
      expect(step).toBeLessThanOrEqual(Math.min(1, fullWidth / 2));
      expect(width[0]).toBeLessThan(fullWidth);
      expect(width[1]).toBe(2 * fullWidth);
      expect(shift[0]).toBe(-shift[1]);
      expect(shift[1]).toBeGreaterThanOrEqual(fullWidth / 2);
      expect(onGrid(0, shift[0], step)).toBe(true);
    }
  );

  it('steps by whole units over large ranges', () => {
    expect(mappingRangeSliders(6095)).toEqual({
      step: 1,
      shift: [-3048, 3048],
      width: [1, 12190],
    });
  });
});
