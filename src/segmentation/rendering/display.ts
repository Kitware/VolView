import type { ResolvedLabelmapSegment } from '@/src/segmentation/model';

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
export const SEGMENT_COINCIDENT_OFFSET = [-4, -4] as const;

/**
 * Fill alpha in 0..1 for the slice representation's piecewise function: the
 * segment's own alpha scaled by its fill opacity and by the segmentation's,
 * the same way segmentOutline composes the outline opacity.
 */
export const segmentFillAlpha = (
  segment: ResolvedLabelmapSegment,
  segmentationOpacity: number
) =>
  segment.visible
    ? ((segment.color[3] || 0) / 255) *
      segment.fillOpacity *
      segmentationOpacity
    : 0;

/**
 * The label outline tables vtk.js indexes by label value minus one, for the one
 * label a mask holds.
 */
export const segmentOutline = (
  segment: ResolvedLabelmapSegment,
  thickness: number,
  segmentationOpacity: number
) => ({
  thicknesses: [segment.visible ? thickness : 0],
  opacities: [segmentationOpacity * segment.outlineOpacity],
});
