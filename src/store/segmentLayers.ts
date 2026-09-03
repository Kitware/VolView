import type vtkLabelMap from '@/src/vtk/LabelMap';
import {
  extentSize,
  isEmptyExtent,
  LABELMAP_BACKGROUND_VALUE,
  maskOffset,
  maskScalars,
  type Extent3D,
  type MaskBounds,
} from '@/src/types/segmentation';

// Bounded masks read as one parent-shaped picture: how a mask is written into
// that picture, and which masks can share one without losing a voxel.

/** A mask's buffer with the bounds its offsets are taken against. */
export type BoundedScalars = MaskBounds & {
  mask: vtkLabelMap;
  scalars: Uint8Array;
};

/**
 * A mask with the strides its extent implies, absent when it holds nothing. The
 * extent is copied because the callers read it per voxel and a segment's own
 * copy lives in the reactive tree.
 */
export function boundScalars(
  mask: vtkLabelMap | undefined,
  bounds: Extent3D
): BoundedScalars | undefined {
  if (!mask || isEmptyExtent(bounds)) return undefined;
  const extent = [...bounds] as Extent3D;
  const [mi, mj] = extentSize(extent);
  return { mask, scalars: maskScalars(mask), extent, mi, mj };
}

/**
 * A mask as grouping reads it: the box it may hold voxels in, and whether it
 * holds one at a parent index.
 */
export type LayerMask = {
  extent: Extent3D;
  filledAt: (i: number, j: number, k: number) => boolean;
};

export const layerMaskOf = (bounded: BoundedScalars): LayerMask => ({
  extent: bounded.extent,
  filledAt: (i, j, k) =>
    bounded.scalars[maskOffset(bounded, i, j, k)] !== LABELMAP_BACKGROUND_VALUE,
});

/** The box both extents cover, empty when they miss. */
const sharedExtent = (a: Extent3D, b: Extent3D): Extent3D => [
  Math.max(a[0], b[0]),
  Math.min(a[1], b[1]),
  Math.max(a[2], b[2]),
  Math.min(a[3], b[3]),
  Math.max(a[4], b[4]),
  Math.min(a[5], b[5]),
];

/**
 * Whether two masks claim one voxel in common. A mask is bounded to the voxels
 * it holds, so boxes that miss cannot share a voxel and neither buffer is read.
 */
export function masksIntersect(a: LayerMask, b: LayerMask) {
  const shared = sharedExtent(a.extent, b.extent);
  if (isEmptyExtent(shared)) return false;

  // One flat sweep, since three nested loops would nest deeper than the style
  // allows and the extents have already cut the common case.
  const [ni, nj, nk] = extentSize(shared);
  const plane = ni * nj;
  for (let n = 0; n < plane * nk; n += 1) {
    const i = shared[0] + (n % ni);
    const j = shared[2] + (Math.floor(n / ni) % nj);
    const k = shared[4] + Math.floor(n / plane);
    if (a.filledAt(i, j, k) && b.filledAt(i, j, k)) return true;
  }
  return false;
}

/**
 * Items grouped so no group holds two masks that claim a voxel in common.
 * Greedy first fit: an item takes the lowest group it does not intersect, so a
 * segmentation with no overlap stays one group, in order. An item with no mask
 * claims nothing and joins the first group.
 */
export function groupByLayer<T>(
  items: T[],
  maskOf: (item: T) => BoundedScalars | undefined
) {
  const layers: Array<{ items: T[]; masks: LayerMask[] }> = [];
  const fits = (layer: { masks: LayerMask[] }, mask: LayerMask | undefined) =>
    !mask || layer.masks.every((other) => !masksIntersect(mask, other));

  items.forEach((item) => {
    const bounded = maskOf(item);
    const mask = bounded ? layerMaskOf(bounded) : undefined;
    const found = layers.find((layer) => fits(layer, mask));
    const layer = found ?? { items: [], masks: [] };
    if (!found) layers.push(layer);
    layer.items.push(item);
    if (mask) layer.masks.push(mask);
  });

  return layers.map((layer) => layer.items);
}

/**
 * Marks a bounded mask's voxels in a parent-shaped buffer. Masks are written in
 * `order`, so a later one takes a voxel an earlier one also claims.
 */
export function writeMaskInto(
  values: Uint8Array,
  dimensions: readonly number[],
  bounded: BoundedScalars
) {
  const { extent, scalars } = bounded;
  const [dx, dy] = dimensions;
  for (let k = extent[4]; k <= extent[5]; k += 1) {
    for (let j = extent[2]; j <= extent[3]; j += 1) {
      const to = j * dx + k * dx * dy;
      const from = maskOffset(bounded, extent[0], j, k) - extent[0];
      for (let i = extent[0]; i <= extent[1]; i += 1) {
        // Background is 0, so a voxel this mask leaves unclaimed keeps
        // whatever the buffer already holds there.
        values[to + i] = scalars[from + i] || values[to + i];
      }
    }
  }
}
