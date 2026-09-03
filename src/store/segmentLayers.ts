import type vtkLabelMap from '@/src/vtk/LabelMap';
import {
  extentContainsIndex,
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

/** Whether any of these masks holds the voxel at PARENT indices i, j, k. */
export const masksHolding =
  (masks: BoundedScalars[]) => (i: number, j: number, k: number) =>
    masks.some(
      (bounded) =>
        extentContainsIndex(bounded.extent, i, j, k) &&
        bounded.scalars[maskOffset(bounded, i, j, k)] !==
          LABELMAP_BACKGROUND_VALUE
    );

/**
 * Clears the voxel at PARENT indices i, j, k from every one of these masks. A
 * mask that does not reach the voxel has nothing there to clear, so nothing
 * grows.
 */
export const masksClearing =
  (masks: BoundedScalars[]) => (i: number, j: number, k: number) =>
    masks.forEach((bounded) => {
      if (!extentContainsIndex(bounded.extent, i, j, k)) return;
      const offset = maskOffset(bounded, i, j, k);
      if (bounded.scalars[offset] === LABELMAP_BACKGROUND_VALUE) return;
      bounded.scalars[offset] = LABELMAP_BACKGROUND_VALUE;
      bounded.mask.modified();
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

/** A mask's buffer, positioned where one row of the shared box starts in it. */
type MaskRow = { scalars: Uint8Array; from: number };

const rowAt = (
  bounded: BoundedScalars,
  i: number,
  j: number,
  k: number
): MaskRow => ({
  scalars: bounded.scalars,
  from: maskOffset(bounded, i, j, k),
});

/**
 * Whether both rows hold a voxel at the same step along i. Background is 0, so
 * a claimed voxel is a truthy one.
 */
function rowsIntersect(a: MaskRow, b: MaskRow, count: number) {
  const { scalars: av, from: ai } = a;
  const { scalars: bv, from: bi } = b;
  for (let n = 0; n < count; n += 1) {
    if (av[ai + n] && bv[bi + n]) return true;
  }
  return false;
}

/**
 * Whether two masks claim one voxel in common. A mask is bounded to the voxels
 * it holds, so boxes that miss cannot share a voxel and neither buffer is read.
 * Boxes that meet are swept a row at a time: two segments that touch nowhere
 * usually still share a box, so the sweep is the common case, and each row
 * costs one offset per mask with a plain step along i from there.
 */
export function masksIntersect(a: BoundedScalars, b: BoundedScalars) {
  const shared = sharedExtent(a.extent, b.extent);
  if (isEmptyExtent(shared)) return false;

  const [ni, nj, nk] = extentSize(shared);
  const i = shared[0];
  // Rows flat in one loop, since a j loop inside a k loop would nest deeper
  // than the style allows once the row test is in it.
  for (let row = 0; row < nj * nk; row += 1) {
    const j = shared[2] + (row % nj);
    const k = shared[4] + Math.floor(row / nj);
    if (rowsIntersect(rowAt(a, i, j, k), rowAt(b, i, j, k), ni)) return true;
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
  const layers: Array<{ items: T[]; masks: BoundedScalars[] }> = [];
  const fits = (
    layer: { masks: BoundedScalars[] },
    mask: BoundedScalars | undefined
  ) => !mask || layer.masks.every((other) => !masksIntersect(mask, other));

  items.forEach((item) => {
    const mask = maskOf(item);
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
