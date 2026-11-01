import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import type { OccupiedDepthResult } from '@/src/segmentation/measurements/occupiedDepth';

const unitRoundoff = Number.EPSILON / 2;
// Calibration and threshold conversion plus two products contribute roundoff.
const relativeRoundoff = (4 * unitRoundoff) / (1 - 4 * unitRoundoff);

export const isPresentThicknessBelow = (thickness: number, threshold: number) =>
  thickness > 0 &&
  threshold - thickness >
    relativeRoundoff * Math.max(Math.abs(thickness), Math.abs(threshold));

/** Counts are integers, so the highlighted set changes only when this does. */
export function thinCountCutoff(
  result: OccupiedDepthResult,
  threshold: number,
  micronsPerVoxel: number
) {
  let cutoff = 0;
  while (
    cutoff < result.maximumCount &&
    isPresentThicknessBelow((cutoff + 1) * micronsPerVoxel, threshold)
  )
    cutoff++;
  return cutoff;
}

export function createThinRegionMask(counts: Uint32Array, cutoff: number) {
  const pixels = new Uint8Array(counts.length);
  for (let index = 0; index < pixels.length; index++)
    if (counts[index] > 0 && counts[index] <= cutoff)
      pixels[index] = SEGMENT_VALUE;
  return pixels;
}

export function thicknessSliderMaximum(
  result: OccupiedDepthResult | null,
  micronsPerVoxel: number
) {
  if (!result || !Number.isFinite(micronsPerVoxel) || micronsPerVoxel <= 0)
    return 1;
  const maximum = result.maximumCount * micronsPerVoxel;
  // The strict below-threshold comparison needs an endpoint above the maximum.
  const tenths = Math.floor(maximum * 10) + 1;
  return maximum > 0 && !isPresentThicknessBelow(maximum, tenths / 10)
    ? (tenths + 1) / 10
    : tenths / 10;
}

export const EN_FACE_THICKNESS_HELP =
  'Thickness of the selected segment within the slab, along the projection axis. Only occupied voxels are counted; gaps are excluded.';
