import { describe, it } from 'vitest';
import { expect } from 'chai';

import { toOrderedLabels } from '@src/composables/useOrientationLabels';

const SQRT1_3 = 1 / Math.sqrt(3);

describe('toOrderedLabels', () => {
  it("correctly orders a vector's LPS labels", () => {
    type Cases = Array<[[number, number, number], string]>;
    const cases: Cases = [
      [[1, 0, 0], 'L'],
      [[0, 1, 0], 'P'],
      [[0, 0, 1], 'S'],
      [[Math.SQRT1_2, Math.SQRT1_2, 0], 'LP'],
      [[Math.SQRT1_2, -Math.SQRT1_2, 0], 'LA'],
      [[0, Math.SQRT1_2, Math.SQRT1_2], 'PS'],
      [[0, Math.SQRT1_2, -Math.SQRT1_2], 'PI'],
      [[Math.SQRT1_2, 0, Math.SQRT1_2], 'LS'],
      [[-Math.SQRT1_2, 0, Math.SQRT1_2], 'RS'],
      [[SQRT1_3, SQRT1_3, SQRT1_3], 'LPS'],
      [[-SQRT1_3, SQRT1_3, -SQRT1_3], 'RPI'],
      [[0.06, 0.989, 0.128], 'PSL'],
    ];

    cases.forEach(([vector, expected]) =>
      expect(toOrderedLabels(vector)).to.equal(expected)
    );
  });
});
