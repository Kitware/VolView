import { describe, expect, it } from 'vitest';
import '@/src/vtk/ColorMaps';
import { looksLikeHounsfieldRange } from '@/src/utils/hounsfieldRange';

describe('looksLikeHounsfieldRange', () => {
  it.each([
    ['CT with air', [-1024, 3071], true],
    ['CT with scanner padding', [-3024, 1500], true],
    ['resampled CT', [-800, 1200], true],
    ['magnitude MR', [0, 4000], false],
    ['normalized intensities', [-3, 5], false],
    ['air without denser tissue', [-1000, 50], false],
  ] as const)('%s', (_, range, expected) => {
    expect(looksLikeHounsfieldRange(range)).toBe(expected);
  });
});
