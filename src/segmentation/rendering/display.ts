import type { ResolvedLabelmapSegment } from '@/src/segmentation/model';

/**
 * Actor opacity for a segment's slice representation. Per-segment and
 * per-segmentation opacity live in the transfer functions, so the actor itself
 * carries none. It must stay below 1: vtk.js puts an image slice in the opaque
 * render pass at an opacity of 1, which restacks it against sibling segments.
 */
export const SEGMENT_ACTOR_OPACITY = 0.9999;

/**
 * All masks use the same depth offset within the segmentation renderer.
 * Translucent segments blend in the order-independent pass with depth writes
 * off, so per-segment offsets would not order overlapping segments.
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
