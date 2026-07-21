import { describe, expect, it } from 'vitest';

import { resultToIntent } from '@/src/processing/engine/resultToIntent';
import type { ProcessingResult } from '@/src/processing/types';

const result = (
  overrides: Partial<ProcessingResult> = {}
): ProcessingResult => ({
  id: 'result-1',
  name: 'report.csv',
  url: '/results/report.csv',
  ...overrides,
});

describe('resultToIntent', () => {
  it.each([
    ['missing', result()],
    ['unknown', result({ intent: 'add-polygon' })],
    [
      'malformed',
      result({
        intent: 'add-segment-group',
        segments: [{ value: 0, name: 'bad', color: [0, 0, 0, 255] }],
      }),
    ],
  ])('returns no state directive for a %s intent', (_name, value) => {
    expect(resultToIntent(value)).toBeUndefined();
  });

  it('returns a declared, shape-valid state directive (carrying the row id)', () => {
    // The whole result row is the candidate now, so the parsed intent keeps the
    // required `id` (a missing id would itself fail the gate).
    expect(resultToIntent(result({ intent: 'add-base-image' }))).toEqual({
      id: 'result-1',
      intent: 'add-base-image',
      name: 'report.csv',
      url: '/results/report.csv',
    });
  });
});
