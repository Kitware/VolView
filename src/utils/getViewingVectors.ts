import { LPSAxis } from '@/src/types/lps';

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
