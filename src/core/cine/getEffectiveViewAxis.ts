import { Maybe } from '@/src/types';
import { LPSAxis } from '@/src/types/lps';
import { ViewInfo2D } from '@/src/types/views';
import { isCineImage } from './isCineImage';

// Cine renders every 2D view as Axial regardless of view.options.orientation,
// so code outside SliceViewer must go through this helper to stay in sync.
export function getEffectiveViewAxis(
  view: ViewInfo2D,
  imageID: Maybe<string>
): LPSAxis {
  if (isCineImage(imageID)) return 'Axial';
  return view.options.orientation;
}
