import { expect } from 'vitest';

const EPSILON = 1e-6;

function numAlmostEqual(a: number, b: number) {
  return Math.abs(a - b) <= EPSILON;
}

function pass(received: any, expected: any) {
  if (typeof received === 'number' && typeof expected === 'number') {
    return numAlmostEqual(received, expected);
  }
  if (Array.isArray(received) && Array.isArray(expected)) {
    return (
      received.length === expected.length &&
      received.every((val, idx) => numAlmostEqual(val, expected[idx]))
    );
  }
  throw new Error('toAlmostEqual does not support given types');
}

expect.extend({
  toAlmostEqual(received, expected) {
    const { isNot } = this;
    return {
      pass: pass(received, expected),
      message: () =>
        `${received} is${isNot ? ' not' : ''} almost equal to ${expected}`,
    };
  },
});
