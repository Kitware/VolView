import { isPresentThicknessBelow } from '@/src/enface/thickness';
import type { OccupiedDepthResult } from '@/src/segmentation/measurements/occupiedDepth';

export const createThinRegionMask = (
  result: OccupiedDepthResult,
  threshold: number,
  micronsPerVoxel: number
) => {
  const pixels = new Uint8Array(result.counts.length);
  for (let index = 0; index < pixels.length; index++) {
    if (
      result.known[index] &&
      isPresentThicknessBelow(result.counts[index] * micronsPerVoxel, threshold)
    )
      pixels[index] = 1;
  }
  return pixels;
};
