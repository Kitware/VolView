const unitRoundoff = Number.EPSILON / 2;
// Calibration and threshold conversion plus two products contribute roundoff.
const relativeRoundoff = (4 * unitRoundoff) / (1 - 4 * unitRoundoff);

export const isPresentThicknessBelow = (thickness: number, threshold: number) =>
  thickness > 0 &&
  threshold - thickness >
    relativeRoundoff * Math.max(Math.abs(thickness), Math.abs(threshold));

export const OCT_THICKNESS_HELP =
  'Thickness counts occupied voxels along the full A-line, independent of the intensity slab. A-lines without the selected label are excluded; missing coverage and zero thickness cannot be distinguished. This user threshold is not a normal reference range.';

export const OCT_COVERAGE_HELP =
  'A-lines without valid intensity in the selected slab have no projection. Thickness is unavailable when labeled voxels overlap declared padding; these A-lines are excluded from highlighting. Highlighting also excludes missing projected pixels.';
