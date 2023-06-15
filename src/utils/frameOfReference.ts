import { vec3 } from 'gl-matrix';
import type { Vector3 } from '@kitware/vtk.js/types';
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
