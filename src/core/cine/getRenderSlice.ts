import { Maybe } from '@/src/types';
import { isCineImage } from './isCineImage';

// VTK render-slice index versus VolView's semantic slice value.
//
// For a normal 3D volume the two are identical.
//
// For a cine image, the semantic slice is the frame cursor and ranges over
// [0, numberOfFrames-1], but the underlying vtkImageData has only one Z slice
// at index 0. Anything that pokes a VTK slice mapper or 2D widget plane needs
// the render slice (always 0 for cine).
export function getRenderSlice(
  imageID: Maybe<string>,
  semanticSlice: number
): number {
  return isCineImage(imageID) ? 0 : semanticSlice;
}
