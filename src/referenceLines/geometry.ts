import { mat3, vec3 } from 'gl-matrix';
import type { Vector3 } from '@kitware/vtk.js/types';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import type { ImageMetadata } from '@/src/types/image';
import type { LPSAxis } from '@/src/types/lps';
import { IMAGE_BOX_INFLATION } from '@/src/constants';

/**
 * An infinite plane in world space.
 */
export type SlicePlane = {
  origin: Vector3;
  /** unit length */
  normal: Vector3;
};

/**
 * A world-space line segment.
 */
export type ReferenceLine = {
  p1: Vector3;
  p2: Vector3;
};

// A direction component smaller than this is treated as zero when clipping.
const DIRECTION_EPSILON = 1e-12;

/**
 * The world-space plane of a slice along an image axis.
 *
 * The normal is taken from `worldToIndex` rather than from a column of the
 * direction matrix so it stays exactly perpendicular to the slice even when
 * the direction matrix is not orthonormal.
 */
export function slicePlane(
  axis: LPSAxis,
  slice: number,
  metadata: ImageMetadata
): SlicePlane {
  const { lpsOrientation, worldToIndex, indexToWorld } = metadata;
  const ijk = lpsOrientation[axis];

  // Row `ijk` of the linear part of worldToIndex is the gradient of the index
  // coordinate, i.e. the plane normal (mat4 is column-major).
  const normal = vec3.fromValues(
    worldToIndex[ijk],
    worldToIndex[4 + ijk],
    worldToIndex[8 + ijk]
  );
  vec3.normalize(normal, normal);

  const indexPoint = vec3.create();
  indexPoint[ijk] = slice;
  const origin = vec3.transformMat4(vec3.create(), indexPoint, indexToWorld);

  return {
    normal: Array.from(normal) as Vector3,
    origin: Array.from(origin) as Vector3,
  };
}

/**
 * Clips the infinite line `p + t*d` against the axis-aligned box
 * `[-0.5, dim - 0.5]` (Liang–Barsky), returning the parameter interval or null
 * when the line misses the box.
 */
function clipToBox(
  point: vec3,
  direction: vec3,
  dimensions: Vector3
): [number, number] | null {
  let tMin = -Infinity;
  let tMax = Infinity;

  // No axis would constrain the interval, so it would come back unbounded.
  if (vec3.squaredLength(direction) === 0) return null;

  for (let axis = 0; axis < 3; axis++) {
    const lo = -IMAGE_BOX_INFLATION;
    const hi = dimensions[axis] - 1 + IMAGE_BOX_INFLATION;
    const d = direction[axis];
    const p = point[axis];

    if (Math.abs(d) < DIRECTION_EPSILON) {
      if (p < lo || p > hi) return null;
    } else {
      const t1 = (lo - p) / d;
      const t2 = (hi - p) / d;
      tMin = Math.max(tMin, Math.min(t1, t2));
      tMax = Math.min(tMax, Math.max(t1, t2));
      if (tMin > tMax) return null;
    }
  }

  return [tMin, tMax];
}

/**
 * The world-space segment where the `peer` plane cuts the `host` plane, clipped
 * to the image box.
 *
 * Returns null when the planes are (near-)parallel — which is also how
 * same-axis peers are rejected — or when the intersection misses the image.
 */
export function computeReferenceLine(
  host: SlicePlane,
  peer: SlicePlane,
  metadata: ImageMetadata
): ReferenceLine | null {
  // vtk.js types `intersectWithPlane` with the `intersectWithLine` result
  // shape; the plane-plane overload actually returns the two line points.
  const { intersection, l0, l1 } = vtkPlane.intersectWithPlane(
    host.origin,
    host.normal,
    peer.origin,
    peer.normal
  ) as unknown as { intersection: boolean; l0: Vector3; l1: Vector3 };
  if (!intersection) return null;

  const { worldToIndex, indexToWorld, dimensions } = metadata;

  // Clip in index space, where the image box is axis-aligned regardless of the
  // image's direction matrix.
  const indexPoint = vec3.transformMat4(
    vec3.create(),
    l0 as vec3,
    worldToIndex
  );
  // A direction is a vector, so it takes only the linear part of the transform.
  // `l1 - l0` is the cross product of the unit normals, whose magnitude is
  // sin(angle); it is normalized first because for nearly parallel planes that
  // is small enough to vanish against a world coordinate in float32.
  const indexDirection = vec3.transformMat3(
    vec3.create(),
    vec3.normalize(
      vec3.create(),
      vec3.subtract(vec3.create(), l1 as vec3, l0 as vec3)
    ),
    mat3.fromMat4(mat3.create(), worldToIndex)
  );

  const interval = clipToBox(indexPoint, indexDirection, dimensions as Vector3);
  if (!interval) return null;

  const [tMin, tMax] = interval;
  const toWorld = (t: number) =>
    Array.from(
      vec3.transformMat4(
        vec3.create(),
        vec3.scaleAndAdd(vec3.create(), indexPoint, indexDirection, t),
        indexToWorld
      )
    ) as Vector3;

  return { p1: toWorld(tMin), p2: toWorld(tMax) };
}
