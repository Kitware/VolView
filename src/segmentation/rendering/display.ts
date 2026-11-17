import type { ResolvedLabelmapSegment } from '@/src/segmentation/model';

export type LabelmapAppearance = {
  value: number;
  color: readonly number[];
  fillOpacity: number;
  outlineThickness: number;
  outlineOpacity: number;
};

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

/** One segment's outline thickness and opacity, as vtk.js label tables. */
export const segmentOutline = (
  segment: ResolvedLabelmapSegment,
  thickness: number,
  segmentationOpacity: number
) => ({
  thicknesses: [segment.visible ? thickness : 0],
  opacities: [segmentationOpacity * segment.outlineOpacity],
});

/** Resolved fill and outline for one labelmap; `pulse` briefly emphasizes it. */
export const labelmapAppearance = (
  segment: ResolvedLabelmapSegment,
  display: {
    fillOpacity: number;
    outlineThickness: number;
    outlineOpacity: number;
  },
  pulse = 0
) => {
  const { thicknesses, opacities } = segmentOutline(
    segment,
    display.outlineThickness + 3 * pulse,
    Math.max(display.outlineOpacity, pulse)
  );
  return {
    value: segment.value,
    color: segment.color,
    fillOpacity: Math.max(
      segmentFillAlpha(segment, display.fillOpacity),
      segment.visible ? 0.7 * pulse : 0
    ),
    outlineThickness: thicknesses[0],
    outlineOpacity: opacities[0],
  };
};

/**
 * Fixed so the mapper's 1024 texel lookup samples land within a quarter value
 * of every label from 1 to 255, which the label plateaus below absorb.
 */
export const LABEL_TABLE_RANGE = [0, 256] as const;
const LABEL_PLATEAU = 0.4;

const plateau = (value: number) => [
  value - LABEL_PLATEAU,
  value + LABEL_PLATEAU,
];

/**
 * Transfer function nodes and outline tables for labels in one plane. Each
 * label is flat over its plateau so a lookup never blends in a neighbor.
 */
export function labelLookupTables(labels: readonly LabelmapAppearance[]) {
  const sorted = [...labels].sort((a, b) => a.value - b.value);
  const [start, end] = LABEL_TABLE_RANGE;
  const colorNode = (x: number, [r, g, b]: readonly number[]) => ({
    x,
    r: r / 255,
    g: g / 255,
    b: b / 255,
    midpoint: 0.5,
    sharpness: 0,
  });
  const opacityNode = (x: number, y: number) => ({
    x,
    y,
    midpoint: 0.5,
    sharpness: 0,
  });
  const black = [0, 0, 0];
  const length = sorted.length ? sorted[sorted.length - 1].value : 0;
  const thicknesses = new Array<number>(length).fill(0);
  const opacities = new Array<number>(length).fill(0);
  sorted.forEach((label) => {
    thicknesses[label.value - 1] = label.outlineThickness;
    opacities[label.value - 1] = label.outlineOpacity;
  });
  return {
    colorNodes: [
      colorNode(start, black),
      ...sorted.flatMap((label) =>
        plateau(label.value).map((x) => colorNode(x, label.color))
      ),
      colorNode(end, black),
    ],
    opacityNodes: [
      opacityNode(start, 0),
      ...sorted.flatMap((label) =>
        plateau(label.value).map((x) => opacityNode(x, label.fillOpacity))
      ),
      opacityNode(end, 0),
    ],
    thicknesses,
    opacities,
  };
}
