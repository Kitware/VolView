import {
  clipExtent,
  extentReachesSlice,
  extentSize,
  extentUnion,
  isEmptyExtent,
  maskOffset,
  padExtent,
  type Extent3D,
  type MaskBounds,
} from '@/src/segmentation/geometry';

/** vtk.js label outlines read plane values as bytes: labels 1 through 255. */
export const PLANE_LABEL_CAPACITY = 255;

export type SliceMask = { id: string; extent: Extent3D; scalars: Uint8Array };

/** One label plane: the segment at label L is `segmentIds[L - 1]`. */
export type SlicePlane = { values: Uint8Array; segmentIds: string[] };

/**
 * The displayed plane covering every mask that reaches it, padded with known
 * background but never past the scan, or null when no mask reaches it.
 */
export function slicePlaneExtent(
  extents: readonly Extent3D[],
  parent: Extent3D,
  axis: number,
  slice: number
) {
  const index = Math.round(slice);
  const reaching = extents.filter(
    (extent) =>
      !isEmptyExtent(extent) && extentReachesSlice(extent, axis, index)
  );
  if (reaching.length === 0) return null;
  const plane = clipExtent(padExtent(reaching.reduce(extentUnion), 1), parent);
  plane[axis * 2] = index;
  plane[axis * 2 + 1] = index;
  return plane;
}

const boundsOf = (extent: Extent3D): MaskBounds => {
  const [mi, mj] = extentSize(extent);
  return { extent, mi, mj };
};

/** Writes the plane offsets of the mask's claimed pixels into `into`. */
function claimedPixels(mask: SliceMask, plane: MaskBounds, into: Int32Array) {
  const shared = clipExtent(mask.extent, plane.extent);
  if (isEmptyExtent(shared)) return 0;
  const source = boundsOf(mask.extent);
  const width = shared[1] - shared[0] + 1;
  const { scalars } = mask;
  let count = 0;
  // Plain loops: this runs per pixel of every mask on every recomposition.
  for (let k = shared[4]; k <= shared[5]; k += 1) {
    for (let j = shared[2]; j <= shared[3]; j += 1) {
      const from = maskOffset(source, shared[0], j, k);
      const to = maskOffset(plane, shared[0], j, k) - from;
      const end = from + width;
      for (let at = from; at < end; at += 1) {
        into[count] = to + at;
        count += scalars[at] ? 1 : 0;
      }
    }
  }
  return count;
}

/** Which of one word's 32 planes claim any of these pixels, as bits. */
function claimedBits(word: Uint32Array, pixels: Int32Array, count: number) {
  let bits = 0;
  for (let n = 0; n < count; n += 1) bits |= word[pixels[n]];
  return bits;
}

const lowestBit = (bits: number) => 31 - Math.clz32(bits & -bits);

/**
 * Writes each mask's pixels on the plane `extent` into label planes. A mask
 * takes the first plane where it claims no pixel already claimed and a label
 * is free, so masks that do not overlap here share one plane, in order. A
 * mask with no pixel on this plane takes no label. A buffer in `reuse` of the
 * right length is cleared and written instead of allocating one.
 */
export function composeSlice(
  masks: readonly SliceMask[],
  extent: Extent3D,
  reuse: readonly Uint8Array[] = []
) {
  const plane = boundsOf(extent);
  const [ni, nj, nk] = extentSize(extent);
  const size = ni * nj * nk;
  const layers: SlicePlane[] = [];
  const layerAt = (index: number) => {
    if (!layers[index]) {
      const held = reuse[index];
      const values =
        held?.length === size ? held.fill(0) : new Uint8Array(size);
      layers[index] = { values, segmentIds: [] };
    }
    return layers[index];
  };
  // Bit b of words[w] at a pixel says plane 32 * w + b claims it.
  const words: Uint32Array[] = [];
  const full: number[] = [];
  const pixels = new Int32Array(size);
  const firstFreePlane = (count: number) => {
    for (let w = 0; ; w += 1) {
      words[w] ??= new Uint32Array(size);
      full[w] ??= 0;
      const free = ~(claimedBits(words[w], pixels, count) | full[w]);
      if (free) return w * 32 + lowestBit(free);
    }
  };
  masks.forEach((mask) => {
    const count = claimedPixels(mask, plane, pixels);
    if (count === 0) return;
    const index = firstFreePlane(count);
    const layer = layerAt(index);
    const label = layer.segmentIds.push(mask.id);
    const word = words[index >> 5];
    const bit = 1 << (index & 31);
    for (let n = 0; n < count; n += 1) {
      layer.values[pixels[n]] = label;
      word[pixels[n]] |= bit;
    }
    if (label === PLANE_LABEL_CAPACITY) full[index >> 5] |= bit;
  });
  return layers;
}
