import { vec3 } from 'gl-matrix';
import type { Vector2, Vector3 } from '@kitware/vtk.js/types';
import vtkMath from '@kitware/vtk.js/Common/Core/Math';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import { LPSAxis } from '../types/lps';
import { EPSILON } from '../constants';
import { roundIfCloseToInteger } from '.';
import { ImageMetadata } from '../types/image';

const tmp = vec3.create();

/**
 * Defines a 2D plane used for locating annotations.
 */
export interface FrameOfReference {
  planeNormal: Vector3;
  planeOrigin: Vector3;
}

export interface FrameOfReferenceToImageSliceAndAxisOptions {
  epsilon?: number;
  allowNonIntegralSlice?: boolean;
  allowOutOfBoundsSlice?: boolean;
}

/**
 * Returns the image slice and LPS axis for a given frame of reference.
 *
 * If the frame of reference is not aligned to the image metadata, then null is returned.
 * @param {FrameOfReference} frame
 * @param {ImageMetadata} metadata
 * @param {FrameOfReferenceToImageSliceAndAxisOptions?} options
 */
export function frameOfReferenceToImageSliceAndAxis(
  frame: FrameOfReference,
  metadata: ImageMetadata,
  options?: FrameOfReferenceToImageSliceAndAxisOptions
): { axis: LPSAxis; slice: number } | null {
  const epsilon = options?.epsilon ?? EPSILON;
  const allowNonIntegralSlice = options?.allowNonIntegralSlice ?? false;
  const allowOutOfBoundsSlice = options?.allowOutOfBoundsSlice ?? false;

  const { planeNormal, planeOrigin } = frame;
  const { dimensions, lpsOrientation, worldToIndex } = metadata;

  let axis: LPSAxis | null = null;
  const { Left, Right, Posterior, Anterior, Superior, Inferior } =
    lpsOrientation;
  if (vec3.equals(Left, planeNormal) || vec3.equals(Right, planeNormal)) {
    axis = 'Sagittal';
  } else if (
    vec3.equals(Posterior, planeNormal) ||
    vec3.equals(Anterior, planeNormal)
  ) {
    axis = 'Coronal';
  } else if (
    vec3.equals(Superior, planeNormal) ||
    vec3.equals(Inferior, planeNormal)
  ) {
    axis = 'Axial';
  }

  if (!axis) {
    return null;
  }

  vec3.transformMat4(tmp, planeOrigin, worldToIndex);
  const index = lpsOrientation[axis];
  const slice = roundIfCloseToInteger(tmp[index], epsilon);

  if (!allowNonIntegralSlice && !Number.isInteger(slice)) {
    return null;
  }

  if (!allowOutOfBoundsSlice && (slice < 0 || slice >= dimensions[index])) {
    return null;
  }

  return { axis, slice };
}

export function getSmallestSpacing(
  frame: FrameOfReference,
  metadata: ImageMetadata
): number {
  const sliceAxis = frameOfReferenceToImageSliceAndAxis(frame, metadata);
  if (!sliceAxis) return Math.min(...metadata.spacing); // off orthogonal
  const axisIndex = metadata.lpsOrientation[sliceAxis.axis];
  const spacing = [...metadata.spacing];
  spacing.splice(axisIndex, 1);
  return Math.min(...spacing);
}

export function getPlaneTransforms({
  planeOrigin,
  planeNormal,
}: FrameOfReference) {
  const scratchA = [0, 0, 0] as Vector3;
  const scratchB = [0, 0, 0] as Vector3;
  const e1 = [0, 0, 0] as Vector3;
  const e2 = [0, 0, 0] as Vector3;
  // Pick a vector orthogonal to the normal
  if (Math.abs(planeNormal[0]) > 1e-6) {
    e1[0] = -planeNormal[1];
    e1[1] = planeNormal[0];
    e1[2] = 0;
  } else if (Math.abs(planeNormal[1]) > 1e-6) {
    e1[0] = 0;
    e1[1] = -planeNormal[2];
    e1[2] = planeNormal[1];
  } else {
    e1[0] = planeNormal[2];
    e1[1] = 0;
    e1[2] = -planeNormal[0];
  }
  vtkMath.cross(planeNormal, e1, e2);
  vtkMath.normalize(e1);
  vtkMath.normalize(e2);

  const plane = vtkPlane.newInstance();
  plane.setOrigin(planeOrigin);
  plane.setNormal(planeNormal);

  const to2D = (point3D: Vector3) => {
    plane.projectPoint(point3D, scratchA);
    const v = vtkMath.subtract(scratchA, planeOrigin, scratchB);
    const x = vtkMath.dot(v, e1);
    const y = vtkMath.dot(v, e2);
    return [x, y] as Vector2;
  };

  const to3D = (point2D: Vector2) => {
    const [x, y] = point2D;

    const point3D = [0, 0, 0] as Vector3;

    scratchA[0] = e1[0];
    scratchA[1] = e1[1];
    scratchA[2] = e1[2];
    scratchB[0] = e2[0];
    scratchB[1] = e2[1];
    scratchB[2] = e2[2];

    vtkMath.multiplyScalar(scratchA, x);
    vtkMath.multiplyScalar(scratchB, y);
    vtkMath.add(planeOrigin, scratchA, point3D);
    vtkMath.add(point3D, scratchB, point3D);

    return point3D;
  };

  return { to2D, to3D };
}
