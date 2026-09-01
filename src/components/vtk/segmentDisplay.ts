import type { LabelmapSegment } from '@/src/types/segmentation';

/**
 * Fill alpha in 0..1 for the slice representation's piecewise function: the
 * segment's own alpha scaled by its fill opacity.
 */
export const segmentFillAlpha = (segment: LabelmapSegment) =>
  segment.visible
    ? ((segment.color[3] || 0) / 255) * (segment.fillOpacity ?? 1)
    : 0;

/**
 * The label outline tables vtk.js indexes by label value minus one, so both run
 * from value 1 to the largest value in use. A value no segment claims keeps the
 * group defaults.
 */
export const segmentOutlineTables = (
  segments: LabelmapSegment[],
  groupThickness: number,
  groupOpacity: number
) => {
  const byValue = new Map(segments.map((segment) => [segment.value, segment]));
  const largestValue = segments.reduce(
    (largest, segment) => Math.max(largest, segment.value),
    0
  );
  const at = (index: number) => byValue.get(index + 1);

  return {
    thicknesses: Array.from({ length: largestValue }, (_, index) => {
      const segment = at(index);
      return !segment || segment.visible ? groupThickness : 0;
    }),
    opacities: Array.from(
      { length: largestValue },
      (_, index) => groupOpacity * (at(index)?.outlineOpacity ?? 1)
    ),
  };
};
