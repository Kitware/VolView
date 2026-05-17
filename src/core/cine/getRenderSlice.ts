import { Maybe } from '@/src/types';
import { isCineImage } from './isCineImage';

// VTK render-slice index for a 2D mapper or widget plane. Cine images always
// render at z=0 (frame index lives elsewhere). For volumes, an explicit
// `toolSlice` (e.g. a ruler pinned to its own slice) wins over the view's.
export function getRenderSlice(
  imageID: Maybe<string>,
  viewSlice: Maybe<number>,
  toolSlice?: Maybe<number>
): number {
  if (isCineImage(imageID)) return 0;
  return toolSlice ?? viewSlice ?? 0;
}
