import type { LPSAxis, LPSDirections } from '@/src/types/lps';
import { LPSAxes } from '@/src/utils/lps';

export function get2DOrientationForSourceAxis(
  sourceAxis: 0 | 1 | 2,
  directions: LPSDirections
) {
  const orientation = LPSAxes.find((axis) => directions[axis] === sourceAxis)!;
  return { name: orientation, ...get2DViewingVectors(orientation) };
}

export function get2DViewingVectors(viewerOrientation: LPSAxis) {
  switch (viewerOrientation) {
    case 'Coronal':
      return {
        viewDirection: 'Posterior' as const,
        viewUp: 'Superior' as const,
      };
    case 'Sagittal':
      return {
        viewDirection: 'Right' as const,
        viewUp: 'Superior' as const,
      };
    case 'Axial':
      return {
        viewDirection: 'Superior' as const,
        viewUp: 'Anterior' as const,
      };
    default:
      throw new Error(`invalid viewer orientation: ${viewerOrientation}`);
  }
}
