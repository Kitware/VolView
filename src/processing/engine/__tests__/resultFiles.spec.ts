import { describe, expect, it } from 'vitest';

import {
  offersSceneLoad,
  sceneApplicableResults,
} from '@/src/processing/engine/resultFiles';
import type { ProcessingResult } from '@/src/processing/types';

const result = (
  overrides: Partial<ProcessingResult> = {}
): ProcessingResult => ({
  id: 'result-1',
  name: 'report.csv',
  url: '/api/v1/file/deadbeefdeadbeefdeadbeef/proxiable/report.csv',
  ...overrides,
});

const image = result({ id: 'result-2', intent: 'add-base-image' });

describe('sceneApplicableResults', () => {
  it('keeps only the results carrying a known intent', () => {
    expect(sceneApplicableResults([result(), image])).toEqual([image]);
  });

  it('drops a result whose intent name is known but shape is invalid', () => {
    const malformed = result({
      intent: 'add-segment-group',
      segments: [{ value: 0, name: 'bad', color: [0, 0, 0, 255] }],
    });
    expect(sceneApplicableResults([malformed])).toEqual([]);
  });
});

describe('offersSceneLoad', () => {
  it('offers Load while the result list is still unfetched', () => {
    expect(offersSceneLoad(undefined)).toBe(true);
  });

  it('offers Load when at least one result applies to the scene', () => {
    expect(offersSceneLoad([result(), image])).toBe(true);
  });

  it('withholds Load for a report-only job', () => {
    expect(offersSceneLoad([result()])).toBe(false);
  });

  it('withholds Load for a job that produced nothing', () => {
    expect(offersSceneLoad([])).toBe(false);
  });
});
