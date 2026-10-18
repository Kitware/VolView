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

/** Exposed pixel edges outline the selected region, including any holes. */
export function thinRegionOutlinePath(
  { width, height, values, thicknessMicrons }: ProjectionResult,
  threshold: number
) {
  if (!thicknessMicrons) return '';
  const selected = (x: number, y: number) =>
    x >= 0 &&
    x < width &&
    y >= 0 &&
    y < height &&
    Number.isFinite(values[x + y * width]) &&
    isPresentThicknessBelow(thicknessMicrons[x + y * width], threshold);
  const edges: string[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!selected(x, y)) continue;
      if (!selected(x, y - 1)) edges.push(`M${x},${y}h1`);
      if (!selected(x, y + 1)) edges.push(`M${x},${y + 1}h1`);
      if (!selected(x - 1, y)) edges.push(`M${x},${y}v1`);
      if (!selected(x + 1, y)) edges.push(`M${x + 1},${y}v1`);
    }
  }
  return edges.join('');
}

export const OCT_THICKNESS_HELP =
  'Thickness counts occupied voxels along the full A-line, independent of the intensity slab. A-lines without the selected label are excluded; missing coverage and zero thickness cannot be distinguished. This user threshold is not a normal reference range.';
