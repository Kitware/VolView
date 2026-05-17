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
//
// `toolSlice` is an optional per-tool override (e.g. a ruler pinned to a
// specific slice) — when defined it wins over the view's current slice.
export function getRenderSlice(
  imageID: Maybe<string>,
  viewSlice: Maybe<number>,
  toolSlice?: Maybe<number>
): number {
  if (isCineImage(imageID)) return 0;
  return toolSlice ?? viewSlice ?? 0;
}
