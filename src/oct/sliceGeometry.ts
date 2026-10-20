import { vec3 } from 'gl-matrix';
import type { Vector3 } from '@kitware/vtk.js/types';
import type { ImageMetadata } from '@/src/types/image';
import type { ProjectionAxis } from '@/src/oct/types';
import { computeReferenceLine, type SlicePlane } from '@/src/referenceLines';

/** Intersect a world-space slice plane with the displayed en face slab midpoint. */
export function enFaceSliceLine(
  axis: ProjectionAxis,
  depth: number,
  peer: SlicePlane,
  metadata: ImageMetadata
) {
  const { worldToIndex, indexToWorld } = metadata;
  const normal = vec3.fromValues(
    worldToIndex[axis],
    worldToIndex[4 + axis],
    worldToIndex[8 + axis]
  );
  vec3.normalize(normal, normal);
  const indexOrigin = vec3.create();
  indexOrigin[axis] = depth;
  const origin = vec3.transformMat4(vec3.create(), indexOrigin, indexToWorld);
  const line = computeReferenceLine(
    {
      normal: Array.from(normal) as Vector3,
      origin: Array.from(origin) as Vector3,
    },
    peer,
    metadata
  );
  if (!line) return null;
  const horizontal = axis === 0 ? 1 : 0;
  const vertical = axis === 2 ? 1 : 2;
  const project = (point: Vector3) => {
    const index = vec3.transformMat4(vec3.create(), point, worldToIndex);
    // Canvas pixel centers lie half a pixel inside the image box.
    return [index[horizontal] + 0.5, index[vertical] + 0.5];
  };
  const [x1, y1] = project(line.p1);
  const [x2, y2] = project(line.p2);
  return { x1, y1, x2, y2 };
}
