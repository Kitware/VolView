import { describe, it, expect } from 'vitest';
import { mat4 } from 'gl-matrix';

import { cropPlanesToWorldBounds } from '../bounds';
import type { LPSCroppingPlanes } from '@/src/types/crop';
import type { LPSDirections } from '@/src/types/lps';

// Only the LPS-axis→column mapping is read, so a partial cast suffices.
const dirs = (
  sagittal: 0 | 1 | 2,
  coronal: 0 | 1 | 2,
  axial: 0 | 1 | 2
): LPSDirections =>
  ({ Sagittal: sagittal, Coronal: coronal, Axial: axial }) as LPSDirections;

const planes: LPSCroppingPlanes = {
  Sagittal: [1, 5],
  Coronal: [2, 6],
  Axial: [3, 7],
};

describe('cropPlanesToWorldBounds', () => {
  it('maps index-space crop planes to a world LPS box under an identity transform', () => {
    const bounds = cropPlanesToWorldBounds(
      planes,
      mat4.create(),
      dirs(0, 1, 2)
    );
    expect(bounds).toEqual([1, 5, 2, 6, 3, 7]);
  });

  it('applies the image indexToWorld (scale + translation)', () => {
    // prettier-ignore
    const indexToWorld = mat4.fromValues(
      2, 0, 0, 0,
      0, 3, 0, 0,
      0, 0, 4, 0,
      10, 20, 30, 1
    );
    const bounds = cropPlanesToWorldBounds(planes, indexToWorld, dirs(0, 1, 2));
    expect(bounds).toEqual([12, 20, 26, 38, 42, 58]);
  });

  it('honors a permuted LPS-axis→column mapping (oriented volume)', () => {
    const bounds = cropPlanesToWorldBounds(
      planes,
      mat4.create(),
      dirs(2, 0, 1)
    );
    expect(bounds).toEqual([2, 6, 3, 7, 1, 5]);
  });
});
