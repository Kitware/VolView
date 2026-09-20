/** vtk.js index-space extent order: [iMin, iMax, jMin, jMax, kMin, kMax]. */
export type Extent3D = [number, number, number, number, number, number];

/** Widens `box` in place to take in one more index. */
export const growExtent = (box: Extent3D, i: number, j: number, k: number) => {
  box[0] = Math.min(box[0], i);
  box[1] = Math.max(box[1], i);
  box[2] = Math.min(box[2], j);
  box[3] = Math.max(box[3], j);
  box[4] = Math.min(box[4], k);
  box[5] = Math.max(box[5], k);
};

export function emptyExtent(): Extent3D {
  return [0, -1, 0, -1, 0, -1];
}

/** vtk.js extents are inclusive, so an axis is empty only when max < min. */
export function isEmptyExtent(extent: Extent3D) {
  return (
    extent[1] < extent[0] || extent[3] < extent[2] || extent[5] < extent[4]
  );
}

/** Voxel counts along i, j, k. Meaningless for an empty extent. */
export function extentSize(extent: Extent3D) {
  return [
    extent[1] - extent[0] + 1,
    extent[3] - extent[2] + 1,
    extent[5] - extent[4] + 1,
  ] as [number, number, number];
}

export function extentContains(outer: Extent3D, inner: Extent3D) {
  return (
    inner[0] >= outer[0] &&
    inner[1] <= outer[1] &&
    inner[2] >= outer[2] &&
    inner[3] <= outer[3] &&
    inner[4] >= outer[4] &&
    inner[5] <= outer[5]
  );
}

export function extentContainsIndex(
  extent: Extent3D,
  i: number,
  j: number,
  k: number
) {
  return (
    i >= extent[0] &&
    i <= extent[1] &&
    j >= extent[2] &&
    j <= extent[3] &&
    k >= extent[4] &&
    k <= extent[5]
  );
}

/** A mask's extent with the row and plane strides that extent implies. */
export type MaskBounds = {
  extent: Extent3D;
  mi: number;
  mj: number;
};

/** Where a parent-index voxel sits in the buffer of a mask bounded that way. */
export const maskOffset = (
  bounds: MaskBounds,
  i: number,
  j: number,
  k: number
) =>
  i -
  bounds.extent[0] +
  (j - bounds.extent[2]) * bounds.mi +
  (k - bounds.extent[4]) * bounds.mi * bounds.mj;

/**
 * The box `labelValue` actually occupies inside a mask bounded by `extent`,
 * empty when it occupies nothing. A binding's extent is the allocation, padded
 * and never shrunk by an erase, so it is not the segment's bounds.
 */
export function markedExtent(
  scalars: ArrayLike<number>,
  extent: Extent3D,
  labelValue: number
): Extent3D {
  const ni = extent[1] - extent[0] + 1;
  const nj = extent[3] - extent[2] + 1;
  const nk = extent[5] - extent[4] + 1;
  let bounds: Extent3D | undefined;

  const scanRow = (rowStart: number, j: number, k: number) => {
    for (let index = 0; index < ni; index += 1) {
      if (scalars[rowStart + index] !== labelValue) continue;
      const i = extent[0] + index;
      if (bounds) growExtent(bounds, i, j, k);
      else bounds = [i, i, j, j, k, k];
    }
  };

  for (let row = 0; row < nj * nk; row += 1) {
    scanRow(row * ni, extent[2] + (row % nj), extent[4] + Math.floor(row / nj));
  }

  return bounds ?? emptyExtent();
}

/** The parent-image slice indices containing `labelValue`, for i, j and k. */
export function markedSlices(
  scalars: ArrayLike<number>,
  extent: Extent3D,
  labelValue: number
): [number[], number[], number[]] {
  const ni = extent[1] - extent[0] + 1;
  const nj = extent[3] - extent[2] + 1;
  const occupied = [new Set<number>(), new Set<number>(), new Set<number>()];

  for (let offset = 0; offset < scalars.length; offset += 1) {
    if (scalars[offset] !== labelValue) continue;
    const i = extent[0] + (offset % ni);
    const row = Math.floor(offset / ni);
    const j = extent[2] + (row % nj);
    const k = extent[4] + Math.floor(row / nj);
    occupied[0].add(i);
    occupied[1].add(j);
    occupied[2].add(k);
  }

  return occupied.map((slices) => [...slices]) as [
    number[],
    number[],
    number[],
  ];
}

export function extentUnion(a: Extent3D, b: Extent3D): Extent3D {
  return [
    Math.min(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.max(a[3], b[3]),
    Math.min(a[4], b[4]),
    Math.max(a[5], b[5]),
  ];
}

export function padExtent(extent: Extent3D, padding: number): Extent3D {
  return [
    extent[0] - padding,
    extent[1] + padding,
    extent[2] - padding,
    extent[3] + padding,
    extent[4] - padding,
    extent[5] + padding,
  ];
}

export function clipExtent(extent: Extent3D, bounds: Extent3D): Extent3D {
  return [
    Math.max(extent[0], bounds[0]),
    Math.min(extent[1], bounds[1]),
    Math.max(extent[2], bounds[2]),
    Math.min(extent[3], bounds[3]),
    Math.max(extent[4], bounds[4]),
    Math.min(extent[5], bounds[5]),
  ];
}

export function fullExtent(dimensions: number[] | Int32Array): Extent3D {
  return [0, dimensions[0] - 1, 0, dimensions[1] - 1, 0, dimensions[2] - 1];
}
