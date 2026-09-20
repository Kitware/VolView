import type vtkLabelMap from '@/src/vtk/LabelMap';
import {
  LABELMAP_BACKGROUND_VALUE,
  maskScalars,
} from '@/src/segmentation/model';
import {
  clipExtent,
  emptyExtent,
  extentContainsIndex,
  extentSize,
  extentUnion,
  isEmptyExtent,
  maskOffset,
  type Extent3D,
  type MaskBounds,
} from '@/src/segmentation/geometry';

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
 * The masks that reach the box the caller is about to walk. Clipping once here
 * is what keeps a mask that misses the box out of the per-voxel containment
 * test, and lets the caller skip the walk entirely when none is left.
 */
const masksReaching = (masks: BoundedScalars[], within: Extent3D) =>
  masks.filter((bounded) => !isEmptyExtent(clipExtent(bounded.extent, within)));

/**
 * Whether any of these masks holds the voxel at PARENT indices i, j, k, over
 * the box the caller is about to walk. Absent when no mask reaches that box.
 *
 * The answer is asked once per voxel the caller walks, so the sweep over the
 * reaching masks is a plain indexed loop: a callback taking i, j, k would be a
 * fresh closure per voxel.
 */
export function masksHolding(masks: BoundedScalars[], within: Extent3D) {
  const reaching = masksReaching(masks, within);
  if (reaching.length === 0) return undefined;
  return (i: number, j: number, k: number) => {
    for (let index = 0; index < reaching.length; index += 1) {
      const bounded = reaching[index];
      if (
        extentContainsIndex(bounded.extent, i, j, k) &&
        bounded.scalars[maskOffset(bounded, i, j, k)] !==
          LABELMAP_BACKGROUND_VALUE
      )
        return true;
    }
    return false;
  };
}

/**
 * Clears the voxel at PARENT indices i, j, k from every one of these masks and
 * answers true: nothing left here can refuse the write, which is the same
 * per-voxel answer the occupancy test gives. Absent when no mask reaches
 * `within`, the box the caller is about to walk. A mask that does not reach the
 * voxel has nothing there to clear, so nothing grows. Finish the operation in
 * a finally block to publish each changed mask once, including partial writes.
 */
export function masksClearing(masks: BoundedScalars[], within: Extent3D) {
  const reaching = masksReaching(masks, within);
  if (reaching.length === 0) return undefined;
  const changed = new Set<vtkLabelMap>();
  // Indexed loop, as in masksHolding: claim runs once per voxel the caller
  // walks, and a callback over the reaching masks would allocate per voxel.
  const claim = (i: number, j: number, k: number) => {
    for (let index = 0; index < reaching.length; index += 1) {
      const bounded = reaching[index];
      if (extentContainsIndex(bounded.extent, i, j, k)) {
        const offset = maskOffset(bounded, i, j, k);
        if (bounded.scalars[offset] !== LABELMAP_BACKGROUND_VALUE) {
          bounded.scalars[offset] = LABELMAP_BACKGROUND_VALUE;
          changed.add(bounded.mask);
        }
      }
    }
    return true;
  };
  return {
    claim,
    finish: () => {
      changed.forEach((mask) => mask.modified());
      changed.clear();
    },
  };
}

/**
 * A mask's buffer, positioned where one row of the shared box starts in it.
 */
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
  const shared = clipExtent(a.extent, b.extent);
  if (isEmptyExtent(shared)) return false;

  const [ni] = extentSize(shared);
  const i = shared[0];
  for (let k = shared[4]; k <= shared[5]; k += 1) {
    for (let j = shared[2]; j <= shared[3]; j += 1) {
      if (rowsIntersect(rowAt(a, i, j, k), rowAt(b, i, j, k), ni)) return true;
    }
  }
  return false;
}

/**
 * A layer's claimed voxels, one bit each, over a box that takes in every mask
 * being grouped. Asking whether one more mask fits is then a single sweep of
 * that mask's own extent, rather than a sweep of a shared box per mask already
 * in the layer.
 */
type Occupancy = MaskBounds & { bits: Uint8Array };

function newOccupancy(extent: Extent3D): Occupancy {
  const [mi, mj, mk] = extentSize(extent);
  return {
    extent,
    mi,
    mj,
    bits: new Uint8Array(Math.ceil((mi * mj * mk) / 8)),
  };
}

/**
 * Walks `bounded`'s extent a row at a time, handing each row the offset it
 * starts at in the mask, the offset the same voxel sits at in `into`, and how
 * many voxels the row holds. Stops at the first row answering true. `into`
 * must take in the mask's extent.
 */
function maskRows(
  bounded: BoundedScalars,
  into: MaskBounds,
  row: (from: number, to: number, count: number) => boolean
) {
  const { extent } = bounded;
  const [ni, nj, nk] = extentSize(extent);
  for (let index = 0; index < nj * nk; index += 1) {
    const j = extent[2] + (index % nj);
    const k = extent[4] + Math.floor(index / nj);
    const from = maskOffset(bounded, extent[0], j, k);
    const to = maskOffset(into, extent[0], j, k);
    if (row(from, to, ni)) return true;
  }
  return false;
}

/** Whether this mask claims a voxel the layer already holds. */
const occupancyHits = (occupied: Occupancy, bounded: BoundedScalars) =>
  maskRows(bounded, occupied, (from, to, count) => {
    for (let n = 0; n < count; n += 1) {
      const at = to + n;
      if (bounded.scalars[from + n] && occupied.bits[at >> 3] & (1 << (at & 7)))
        return true;
    }
    return false;
  });

/** Adds this mask's voxels to the ones the layer holds. */
function occupy(occupied: Occupancy, bounded: BoundedScalars) {
  maskRows(bounded, occupied, (from, to, count) => {
    for (let n = 0; n < count; n += 1) {
      const at = to + n;
      // Background is 0, so a voxel the mask leaves unclaimed claims nothing.
      if (bounded.scalars[from + n]) occupied.bits[at >> 3] |= 1 << (at & 7);
    }
    return false;
  });
}

/** The box taking in every one of these masks, empty when there are none. */
function maskedBounds(masks: Array<BoundedScalars | undefined>) {
  let bounds: Extent3D | undefined;
  masks.forEach((bounded) => {
    if (!bounded) return;
    bounds = bounds ? extentUnion(bounds, bounded.extent) : bounded.extent;
  });
  return bounds;
}

/**
 * Items grouped so no group holds two masks that claim a voxel in common.
 * Greedy first fit: an item takes the lowest group it does not intersect, so a
 * segmentation with no overlap stays one group, in order. An item with no mask
 * claims nothing and joins the first group.
 *
 * A layer answers from its occupancy once it holds more than one mask, which
 * is what keeps the cost with the masks' extent instead of with mask pairs. A
 * layer holding one mask is asked directly, so layers that never take a second
 * mask - every mask overlapping every other - allocate nothing.
 */
export function groupByLayer<T>(
  items: T[],
  maskOf: (item: T) => BoundedScalars | undefined
) {
  type Layer = { items: T[]; masks: BoundedScalars[]; occupied?: Occupancy };
  const masks = items.map(maskOf);
  const bounds = maskedBounds(masks) ?? emptyExtent();
  const layers: Layer[] = [];

  const fits = (layer: Layer, mask: BoundedScalars | undefined) => {
    if (!mask) return true;
    if (layer.occupied) return !occupancyHits(layer.occupied, mask);
    return layer.masks.every((other) => !masksIntersect(mask, other));
  };

  const accept = (layer: Layer, mask: BoundedScalars) => {
    layer.masks.push(mask);
    if (layer.occupied) {
      occupy(layer.occupied, mask);
      return;
    }
    if (layer.masks.length < 2) return;
    const occupied = newOccupancy(bounds);
    layer.masks.forEach((held) => occupy(occupied, held));
    layer.occupied = occupied;
  };

  masks.forEach((mask, index) => {
    const found = layers.find((layer) => fits(layer, mask));
    const layer = found ?? { items: [], masks: [] };
    if (!found) layers.push(layer);
    layer.items.push(items[index]);
    if (mask) accept(layer, mask);
  });

  return layers.map((layer) => layer.items);
}

/**
 * Marks a bounded mask's voxels in a parent-shaped buffer as `labelValue`. The
 * mask's own bytes only say claimed or not, so the value is the caller's.
 * Masks are written in `order`, so a later one takes a voxel an earlier one
 * also claims.
 */
export function writeMaskInto(
  values: Uint8Array | Uint16Array,
  dimensions: readonly number[],
  bounded: BoundedScalars,
  labelValue: number
) {
  const { extent, scalars } = bounded;
  const [dx, dy] = dimensions;
  const [ni, nj, nk] = extentSize(extent);
  // Rows flat in one loop, as in masksIntersect: a j loop inside a k loop would
  // nest deeper than the style allows once the row test is in it.
  for (let row = 0; row < nj * nk; row += 1) {
    const j = extent[2] + (row % nj);
    const k = extent[4] + Math.floor(row / nj);
    const to = extent[0] + j * dx + k * dx * dy;
    const from = maskOffset(bounded, extent[0], j, k);
    for (let n = 0; n < ni; n += 1) {
      // Background is 0, so a voxel this mask leaves unclaimed keeps whatever
      // the buffer already holds there.
      if (scalars[from + n]) values[to + n] = labelValue;
    }
  }
}
