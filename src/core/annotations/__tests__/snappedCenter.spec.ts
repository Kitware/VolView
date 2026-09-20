import { describe, expect, it } from 'vitest';

import { snappedCenter } from '@/src/core/annotations/locator';

const run = (first: number, last: number) =>
  Array.from({ length: last - first + 1 }, (_, index) => first + index);

describe('snappedCenter', () => {
  it('has nowhere to go when the segment holds nothing on the axis', () => {
    expect(snappedCenter([])).toBeUndefined();
  });

  it('takes the middle of a run of slices', () => {
    expect(snappedCenter(run(10, 20))).toBe(15);
  });

  it('settles a half-slice middle on the lower slice', () => {
    expect(snappedCenter(run(10, 15))).toBe(12);
  });

  it('lands on a shape rather than beside it', () => {
    expect(snappedCenter([42])).toBe(42);
  });

  // The whole reason for snapping: content split across distant slices has an
  // empty middle, and a view put there shows none of it. Equally distant
  // shapes settle on the lower slice.
  it('snaps out of the gap between two distant shapes', () => {
    expect(snappedCenter([10, 90])).toBe(10);
  });

  it('settles on the lower of two equally distant shapes listed high first', () => {
    expect(snappedCenter([90, 10])).toBe(10);
  });

  it('prefers the slice nearer the middle', () => {
    expect(snappedCenter([10, 60, 90])).toBe(60);
  });
});
