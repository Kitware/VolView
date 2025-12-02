import { EPSILON } from '@/src/constants';
import { areEquals } from '@kitware/vtk.js/Common/Core/Math';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { Vector3 } from '@kitware/vtk.js/types';
import { vec3 } from 'gl-matrix';
import type { mat4 } from 'gl-matrix';
import { getLPSDirections } from '@/src/utils/lps';
import type { LPSAxis, LPSDirections } from '@/src/types/lps';

// give more fp tolerance due to transforms
const RELAXED_EPSILON = EPSILON * 1e2;

function getImageWorldCorners(im: vtkImageData) {
  const extent = im.getExtent();
  const worldCorners: Vector3[] = [];
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      for (let k = 0; k < 2; k++) {
        worldCorners.push(
          im.indexToWorld([extent[i], extent[j], extent[k]]) as Vector3
        );
      }
    }
  }
  return worldCorners;
}

/**
 * Determines if two images occupy the same space.
 *
 * This will produce invalid results under certain scenarios:
 * - image direction matrices are not invertible
 * @param im1
 * @param im2
 */
export function compareImageSpaces(
  im1: vtkImageData,
  im2: vtkImageData,
  eps = RELAXED_EPSILON
) {
  const corners1 = getImageWorldCorners(im1);
  const corners2 = getImageWorldCorners(im2);
  return corners1.every((p1) => corners2.some((p2) => areEquals(p1, p2, eps)));
}

/**
 * Convert a world point to image index space.
 */
export function worldPointToIndex(image: vtkImageData, worldPoint: vec3): vec3 {
  const indexPoint = vec3.create();
  vec3.transformMat4(indexPoint, worldPoint, image.getWorldToIndex());
  return indexPoint;
}

/**
 * Convert an image index point to world space.
 */
export function indexPointToWorld(image: vtkImageData, indexPoint: vec3): vec3 {
  const worldPoint = vec3.create();
  vec3.transformMat4(worldPoint, indexPoint, image.getIndexToWorld());
  return worldPoint;
}

/**
 * Convert a slice index from source image space to target image space.
 * Used when source and target have different coordinate systems.
 */
export function convertSliceIndex(
  sourceSlice: number,
  sourceLps: LPSDirections,
  sourceIndexToWorld: mat4,
  targetImage: vtkImageData,
  axis: LPSAxis
): number {
  const sourceIjkIndex = sourceLps[axis];
  const targetLps = getLPSDirections(targetImage.getDirection());
  const targetIjkIndex = targetLps[axis];

  const sourceIndexPoint = vec3.fromValues(0, 0, 0);
  sourceIndexPoint[sourceIjkIndex] = sourceSlice;

  const worldPoint = vec3.create();
  vec3.transformMat4(worldPoint, sourceIndexPoint, sourceIndexToWorld);

  const targetIndexPoint = worldPointToIndex(targetImage, worldPoint);
  return Math.round(targetIndexPoint[targetIjkIndex]);
}
