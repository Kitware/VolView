import { describe, expect, it } from 'vitest';
import { centerSlabOnSlice } from '@/src/core/slab/range';

describe('centering a slab on a slice', () => {
  const slab = { first: 10, last: 30, maximum: 40 };

  it('puts the rounded midpoint on a target away from the source edges', () => {
    expect(centerSlabOnSlice(slab, 20)).toEqual({ first: 10, last: 30 });
    expect(centerSlabOnSlice({ first: 2, last: 3, maximum: 20 }, 7)).toEqual({
      first: 6,
      last: 7,
    });
  });

  it.each([
    [0, { first: 0, last: 20 }],
    [3, { first: 0, last: 20 }],
    [40, { first: 20, last: 40 }],
  ])('keeps the thickness when slice %i is near an edge', (slice, expected) => {
    expect(centerSlabOnSlice(slab, slice)).toEqual(expected);
  });

  it('treats an open end as the last source slice', () => {
    expect(
      centerSlabOnSlice({ first: 30, last: null, maximum: 40 }, 5)
    ).toEqual({ first: 0, last: 10 });
  });
});
