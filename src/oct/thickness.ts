import type { ProjectionResult } from '@/src/oct/types';

const unitRoundoff = Number.EPSILON / 2;
// Calibration and threshold conversion plus two products contribute roundoff.
const relativeRoundoff = (4 * unitRoundoff) / (1 - 4 * unitRoundoff);

export const isPresentThicknessBelow = (thickness: number, threshold: number) =>
  thickness > 0 &&
  threshold - thickness >
    relativeRoundoff * Math.max(Math.abs(thickness), Math.abs(threshold));

export function thicknessSliderMaximum(result: ProjectionResult | null) {
  if (!result?.thicknessMicrons) return 1;
  let maximum = 0;
  result.thicknessMicrons.forEach((thickness, pixel) => {
    if (Number.isFinite(result.values[pixel]) && Number.isFinite(thickness))
      maximum = Math.max(maximum, thickness);
  });
  // The strict below-threshold comparison needs an endpoint above the maximum.
  let rounded = (Math.floor(maximum * 10) + 1) / 10;
  if (!Number.isFinite(rounded)) return maximum;
  if (maximum > 0 && !isPresentThicknessBelow(maximum, rounded)) rounded += 0.1;
  return Math.max(0.1, rounded);
}

export const OCT_THICKNESS_HELP =
  'Thickness counts occupied voxels along the full A-line, independent of the intensity slab. A-lines without the selected label are excluded; missing coverage and zero thickness cannot be distinguished. This user threshold is not a normal reference range.';
