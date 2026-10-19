import { isPresentThicknessBelow } from '@/src/oct/thickness';
import type { ProjectionResult } from '@/src/oct/types';

type FillAppearance = {
  color: readonly [number, number, number, number];
  alpha: number;
};

/** Missing intensities stay opaque black regardless of the scalar window. */
export function createThinRegionOverlay(
  result: ProjectionResult,
  threshold: number,
  appearance: FillAppearance | null
) {
  const pixels = new Uint8Array(result.values.length * 4);
  for (let index = 0; index < result.values.length; index++) {
    const offset = index * 4;
    if (!Number.isFinite(result.values[index])) {
      pixels[offset + 3] = 255;
    } else if (
      appearance &&
      result.thicknessMicrons &&
      isPresentThicknessBelow(result.thicknessMicrons[index], threshold)
    ) {
      pixels.set(appearance.color.slice(0, 3), offset);
      pixels[offset + 3] = Math.round(255 * appearance.alpha);
    }
  }
  return pixels;
}
