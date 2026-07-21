import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import type { mat4 } from 'gl-matrix';
import type { Bounds } from '@/backend-contract';
import type { LPSDirections } from '@/src/types/lps';

export type ReadonlyCropPlanes = {
  Sagittal: readonly [number, number];
  Coronal: readonly [number, number];
  Axial: readonly [number, number];
};

// All eight corners are transformed so the result stays correct for oriented volumes.
export const cropPlanesToWorldBounds = (
  planes: ReadonlyCropPlanes,
  indexToWorld: mat4,
  lpsOrientation: LPSDirections
): Bounds => {
  const indexBounds: Bounds = [0, 0, 0, 0, 0, 0];
  (['Sagittal', 'Coronal', 'Axial'] as const).forEach((axis) => {
    const k = lpsOrientation[axis];
    [indexBounds[2 * k], indexBounds[2 * k + 1]] = planes[axis];
  });
  return vtkBoundingBox.transformBounds(
    indexBounds,
    indexToWorld,
    [0, 0, 0, 0, 0, 0]
  ) as Bounds;
};
