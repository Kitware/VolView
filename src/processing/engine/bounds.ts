// ---------------------------------------------------------------------------
// Crop-tool → `bounds` parameter binding (the imaging-native `bounds` field:
// bounds binds from the crop tool).
//
// A `bounds` parameter carries an axis-aligned world-space box in LPS,
// `[xmin, xmax, ymin, ymax, zmin, zmax]` (contract `boundsSchema`). The crop
// tool stores its box per LPS axis in INDEX space (`useCropStore`
// `croppingByImageID`), so binding the crop box to a `bounds` value means
// transforming the box corners through the image's `indexToWorld` and taking
// their axis-aligned world bounding box. Transforming all eight corners keeps
// the result correct for oriented (non-axis-aligned) volumes.
//
// Pure function — no store, no Vue. The caller reads the crop store and the
// image metadata and hands them in.
// ---------------------------------------------------------------------------

import { vec3 } from 'gl-matrix';
import type { mat4 } from 'gl-matrix';
import type { Bounds } from '@/backend-contract';
import type { LPSDirections } from '@/src/types/lps';

// Accept the crop store's deeply-`readonly` planes as-is (the store exposes a
// frozen view); we only read them. Mutable `LPSCroppingPlanes` is assignable.
export type ReadonlyCropPlanes = {
  Sagittal: readonly [number, number];
  Coronal: readonly [number, number];
  Axial: readonly [number, number];
};

// `lpsOrientation` maps each LPS axis to its index-space column (the crop store
// keys its ranges by LPS axis; the column places each range into an index-space
// point).
export const cropPlanesToWorldBounds = (
  planes: ReadonlyCropPlanes,
  indexToWorld: mat4,
  lpsOrientation: LPSDirections
): Bounds => {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  planes.Sagittal.forEach((s) => {
    planes.Coronal.forEach((c) => {
      planes.Axial.forEach((a) => {
        const index: [number, number, number] = [0, 0, 0];
        index[lpsOrientation.Sagittal] = s;
        index[lpsOrientation.Coronal] = c;
        index[lpsOrientation.Axial] = a;
        const world = vec3.transformMat4(vec3.create(), index, indexToWorld);
        for (let k = 0; k < 3; k += 1) {
          min[k] = Math.min(min[k], world[k]);
          max[k] = Math.max(max[k], world[k]);
        }
      });
    });
  });

  return [min[0], max[0], min[1], max[1], min[2], max[2]];
};
