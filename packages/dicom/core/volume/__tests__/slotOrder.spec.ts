import { describe, expect, it } from 'vitest';
import { pickNextSlot } from '../slotOrder';

const range = (count: number) => Array.from({ length: count }, (_, i) => i);

/** Picks until nothing is pending, as a loader with one decode slot would. */
const drain = (pending: number[], focus: number) => {
  const left = new Set(pending);
  const order: number[] = [];
  for (;;) {
    const next = pickNextSlot(left, focus);
    if (next === undefined) return order;
    order.push(next);
    left.delete(next);
  }
};

describe('pickNextSlot', () => {
  it('takes the focus, then halving strides outward from it', () => {
    expect(drain(range(17), 8)).toEqual([
      8, 0, 16, 4, 12, 6, 10, 2, 14, 7, 9, 5, 11, 3, 13, 1, 15,
    ]);
  });

  it('samples coarsely around a focus near one end', () => {
    expect(drain(range(10), 1)).toEqual([1, 9, 5, 3, 7, 0, 2, 4, 6, 8]);
  });

  it('keeps the stride pattern around a focus that is already loaded', () => {
    expect(drain([0, 2, 4, 6, 7, 9], 3)).toEqual([7, 9, 2, 4, 0, 6]);
  });

  it('does not depend on the order of the pending slots', () => {
    const pending = range(33);
    const reversed = [...pending].reverse();
    expect(drain(reversed, 20)).toEqual(drain(pending, 20));
  });

  it('is total: nothing pending, fractional and non-finite focus', () => {
    expect(pickNextSlot([], 3)).toBeUndefined();
    expect(pickNextSlot([0, 5, 9], 4.6)).toBe(5);
    expect(pickNextSlot([3, 2], Number.NaN)).toBe(2);
  });
});
