import { mat4, vec3 } from 'gl-matrix';
import type { Vector3 } from '@kitware/vtk.js/types';
import type { ImageMetadata } from '@/src/types/image';
import type { SlabGeometry } from '@/src/core/slab/geometry';
import { computeReferenceLine, type SlicePlane } from '@/src/referenceLines';

/** Intersect a world-space slice plane with the displayed en face slab midpoint. */
export function enFaceSliceLine(
  geometry: SlabGeometry,
  peer: SlicePlane,
  metadata: ImageMetadata
) {
  const { sourceExtent, pixelToWorld, planeNormal, planeOrigin } = geometry;
  const minimum: Vector3 = [sourceExtent[0], sourceExtent[2], sourceExtent[4]];
  const localToWorld = mat4.translate(
    new Array(16) as mat4,
    metadata.indexToWorld,
    minimum
  );
  const line = computeReferenceLine(
    {
      normal: planeNormal,
      origin: planeOrigin,
    },
    peer,
    {
      ...metadata,
      indexToWorld: localToWorld,
      worldToIndex: mat4.invert(new Array(16) as mat4, localToWorld),
    }
  );
  if (!line) return null;
  const worldToPixel = mat4.invert(new Array(16) as mat4, pixelToWorld);
  const project = (point: Vector3) => {
    const pixel = vec3.transformMat4([0, 0, 0], point, worldToPixel);
    return [pixel[0], pixel[1]];
  };
  const [x1, y1] = project(line.p1);
  const [x2, y2] = project(line.p2);
  return { x1, y1, x2, y2 };
}
