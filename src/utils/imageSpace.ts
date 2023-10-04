import { EPSILON } from '@/src/constants';
import { areEquals } from '@kitware/vtk.js/Common/Core/Math';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { Vector3 } from '@kitware/vtk.js/types';

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
