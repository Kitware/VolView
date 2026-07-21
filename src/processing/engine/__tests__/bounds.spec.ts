import { describe, it, expect } from 'vitest';
import { mat4 } from 'gl-matrix';

import { cropPlanesToWorldBounds } from '../bounds';
import type { LPSCroppingPlanes } from '@/src/types/crop';
import type { LPSDirections } from '@/src/types/lps';

// The converter only reads the LPS-axis→column mapping; the direction vectors
// are irrelevant here, so a partial cast keeps the fixture readable.
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
    // Column-major affine: world = index .* [2,3,4] + [10,20,30].
    // prettier-ignore
    const indexToWorld = mat4.fromValues(
      2, 0, 0, 0,
      0, 3, 0, 0,
      0, 0, 4, 0,
      10, 20, 30, 1
    );
    const bounds = cropPlanesToWorldBounds(planes, indexToWorld, dirs(0, 1, 2));
    // x: 2*{1,5}+10 = {12,20}; y: 3*{2,6}+20 = {26,38}; z: 4*{3,7}+30 = {42,58}
    expect(bounds).toEqual([12, 20, 26, 38, 42, 58]);
  });

  it('honors a permuted LPS-axis→column mapping (oriented volume)', () => {
    // Sagittal→col2, Coronal→col0, Axial→col1: each axis range lands in a
    // different world component, so the world box is still axis-aligned.
    const bounds = cropPlanesToWorldBounds(
      planes,
      mat4.create(),
      dirs(2, 0, 1)
    );
    // world x ← Coronal[2,6], world y ← Axial[3,7], world z ← Sagittal[1,5]
    expect(bounds).toEqual([2, 6, 3, 7, 1, 5]);
  });
});
