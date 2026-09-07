import { describe, expect, it } from 'vitest';

import { snappedCenter } from '@/src/core/annotations/locator';

describe('snappedCenter', () => {
  it('has nowhere to go when the segment holds nothing on the axis', () => {
    expect(snappedCenter([])).toBeUndefined();
  });

  it('takes the middle of a single span', () => {
    expect(snappedCenter([[10, 20]])).toBe(15);
  });

  it('rounds a half-slice middle to one slice', () => {
    expect(snappedCenter([[10, 15]])).toBe(13);
  });

  it('lands on a shape rather than beside it', () => {
    expect(snappedCenter([[42, 42]])).toBe(42);
  });

  // The whole reason for snapping: content split across distant slices has an
  // empty middle, and a view put there shows none of it. Equally distant
  // shapes settle on the lower slice.
  it('snaps out of the gap between two distant shapes', () => {
    expect(
      snappedCenter([
        [10, 10],
        [90, 90],
      ])
    ).toBe(10);
  });

  it('prefers the span nearer the middle', () => {
    expect(
      snappedCenter([
        [10, 10],
        [60, 60],
        [90, 90],
      ])
    ).toBe(60);
  });

  it('stays inside a span that already covers the middle', () => {
    expect(
      snappedCenter([
        [0, 100],
        [40, 42],
      ])
    ).toBe(50);
  });

  it('reaches the near edge of the span closest to the middle', () => {
    expect(
      snappedCenter([
        [0, 10],
        [80, 100],
      ])
    ).toBe(80);
  });
});
