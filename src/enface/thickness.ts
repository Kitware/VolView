import type { OccupiedDepthResult } from '@/src/segmentation/measurements/occupiedDepth';

const unitRoundoff = Number.EPSILON / 2;
// Calibration and threshold conversion plus two products contribute roundoff.
const relativeRoundoff = (4 * unitRoundoff) / (1 - 4 * unitRoundoff);

export const isPresentThicknessBelow = (thickness: number, threshold: number) =>
  thickness > 0 &&
  threshold - thickness >
    relativeRoundoff * Math.max(Math.abs(thickness), Math.abs(threshold));

export function thicknessSliderMaximum(
  result: OccupiedDepthResult | null,
  micronsPerVoxel: number
) {
  if (!result || !Number.isFinite(micronsPerVoxel) || micronsPerVoxel <= 0)
    return 1;
  const maximum = result.maximumCount * micronsPerVoxel;
  // The strict below-threshold comparison needs an endpoint above the maximum.
  let rounded = (Math.floor(maximum * 10) + 1) / 10;
  if (!Number.isFinite(rounded)) return maximum;
  if (maximum > 0 && !isPresentThicknessBelow(maximum, rounded)) rounded += 0.1;
  return Math.max(0.1, rounded);
}

export const EN_FACE_THICKNESS_HELP =
  'Thickness of the selected segment within the slab, along the projection axis. Only occupied voxels are counted; gaps are excluded.';
