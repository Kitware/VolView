import type { LabelmapSegment } from '@/src/segmentation/model';
import type { Extent3D } from '@/src/segmentation/geometry';
import { isEmptyExtent } from '@/src/segmentation/geometry';

/**
 * Whether a segment's actor has anything to draw on the slice being viewed.
 * Extent and slice are both in the parent image's index space, on the index
 * axis the view's LPS axis maps to. vtkImageMapper clamps a slice outside its
 * input to the nearest one, so an actor left visible off its own extent paints
 * a stale slice over the image.
 */
export function sliceWithinExtent(
  extent: Extent3D,
  axisIndex: number,
  slice: number
) {
  if (isEmptyExtent(extent)) return false;
  return slice >= extent[axisIndex * 2] && slice <= extent[axisIndex * 2 + 1];
}

const SEGMENT_OFFSET_FACTOR = -4;

/**
 * Actor opacity for a segment's slice representation. Per-segment and
 * per-segmentation opacity live in the transfer functions, so the actor itself
 * carries none. It must stay below 1: vtk.js puts an image slice in the opaque
 * render pass at an opacity of 1, which restacks it against the base image and
 * the sibling segment actors.
 */
export const SEGMENT_ACTOR_OPACITY = 0.9999;

/**
 * The coincident-topology polygon offset every mask draws at, which lifts it
 * off the coplanar base image. It is the same for all of them: a segment actor
 * is translucent, so vtk.js draws it in the order-independent translucent pass
 * with depth writes off, and a per-segment offset would change nothing about
 * how two segments blend where they overlap.
 */
export const SEGMENT_COINCIDENT_OFFSET: [number, number] = [
  SEGMENT_OFFSET_FACTOR,
  SEGMENT_OFFSET_FACTOR,
];

/**
 * Fill alpha in 0..1 for the slice representation's piecewise function: the
 * segment's own alpha scaled by its fill opacity and by the segmentation's,
 * the same way the outline tables compose theirs.
 */
export const segmentFillAlpha = (
  segment: LabelmapSegment,
  segmentationOpacity = 1
) =>
  segment.visible
    ? ((segment.color[3] || 0) / 255) *
      (segment.fillOpacity ?? 1) *
      segmentationOpacity
    : 0;

/**
 * The label outline tables vtk.js indexes by label value minus one, so both run
 * from value 1 to the largest value in use. A value no segment claims keeps the
 * segmentation defaults.
 */
export const segmentOutlineTables = (
  segments: LabelmapSegment[],
  segmentationThickness: number,
  segmentationOpacity: number
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
      return !segment || segment.visible ? segmentationThickness : 0;
    }),
    opacities: Array.from(
      { length: largestValue },
      (_, index) => segmentationOpacity * (at(index)?.outlineOpacity ?? 1)
    ),
  };
};
