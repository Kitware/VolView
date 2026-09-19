import { TypedArray } from '@kitware/vtk.js/types';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import { inPlaneAxes } from '@/src/segmentation/geometry';

// 4-connected neighbor offsets, shared so the flood-fill loops never allocate
// a neighbor array per visited voxel.
const NEIGHBOR_DU = [-1, 1, 0, 0];
const NEIGHBOR_DV = [0, 0, -1, 1];

type MaskData = TypedArray | number[];

export type FillHolesOptions = {
  // One segment's flat mask, indexed as i + j*dimI + k*dimI*dimJ.
  data: MaskData;
  // Mask IJK dimensions [dimI, dimJ, dimK].
  dimensions: [number, number, number];
  // IJK axis perpendicular to the fill plane (the slice axis).
  axis: 0 | 1 | 2;
  // When set, only this slice index along `axis` is processed.
  // When omitted, every slice along `axis` is processed.
  sliceIndex?: number;
};

type Plane = {
  uDim: number;
  vDim: number;
  offset: (u: number, v: number) => number;
};

// `visited` and `stack` are reused across slices, so the whole run allocates
// them once.
// `visited`: 0 = unvisited, 1 = outside (border-connected).
type Flood = {
  plane: Plane;
  out: MaskData;
  visited: Uint8Array;
  stack: number[];
};

const inPlane = (plane: Plane, u: number, v: number) =>
  u >= 0 && u < plane.uDim && v >= 0 && v < plane.vDim;

// Drain `stack`, expanding the outside region into unvisited non-foreground
// neighbors.
function drain(flood: Flood) {
  const { plane, out, visited, stack } = flood;
  while (stack.length) {
    const p = stack.pop()!;
    const u = p % plane.uDim;
    const v = (p - u) / plane.uDim;
    for (let n = 0; n < 4; n++) {
      const nu = u + NEIGHBOR_DU[n];
      const nv = v + NEIGHBOR_DV[n];
      if (!inPlane(plane, nu, nv)) continue;
      const np = nu + nv * plane.uDim;
      if (out[plane.offset(nu, nv)] !== SEGMENT_VALUE && visited[np] === 0) {
        visited[np] = 1;
        stack.push(np);
      }
    }
  }
}

// Flood the non-foreground cells reachable from the slice border, marking them
// "outside". Whatever it does not reach is enclosed.
function markOutside(flood: Flood) {
  const { plane, out, visited, stack } = flood;
  const seed = (u: number, v: number) => {
    const p = u + v * plane.uDim;
    if (visited[p] === 0 && out[plane.offset(u, v)] !== SEGMENT_VALUE) {
      visited[p] = 1;
      stack.push(p);
    }
  };
  for (let u = 0; u < plane.uDim; u++) {
    seed(u, 0);
    seed(u, plane.vDim - 1);
  }
  for (let v = 0; v < plane.vDim; v++) {
    seed(0, v);
    seed(plane.uDim - 1, v);
  }
  drain(flood);
}

// Background the border flood did not reach is enclosed. Returns how many
// voxels it filled.
function fillEnclosed({ plane, out, visited }: Flood) {
  let filled = 0;
  for (let v = 0; v < plane.vDim; v++) {
    for (let u = 0; u < plane.uDim; u++) {
      const offset = plane.offset(u, v);
      if (visited[u + v * plane.uDim] === 0 && out[offset] === 0) {
        out[offset] = SEGMENT_VALUE;
        filled += 1;
      }
    }
  }
  return filled;
}

// Fills enclosed background regions ("holes") on 2D slices of a mask.
// A hole is background that does not connect to the slice border. Only
// background (0) voxels are filled. Returns a copy of `data` and how many
// voxels were filled; the input is left untouched.
export function fillHoles(opts: FillHolesOptions) {
  const { data, dimensions, axis, sliceIndex } = opts;
  const out = data.slice();

  const strides = [1, dimensions[0], dimensions[0] * dimensions[1]];
  const sliceStride = strides[axis];
  const sliceCount = dimensions[axis];

  const [uAxis, vAxis] = inPlaneAxes(axis);
  const uDim = dimensions[uAxis];
  const vDim = dimensions[vAxis];
  const uStride = strides[uAxis];
  const vStride = strides[vAxis];

  const visited = new Uint8Array(uDim * vDim);
  const stack: number[] = [];

  let filled = 0;
  const firstSlice = sliceIndex ?? 0;
  const lastSlice = sliceIndex ?? sliceCount - 1;

  for (let slice = firstSlice; slice <= lastSlice; slice++) {
    const base = slice * sliceStride;
    visited.fill(0);

    const flood: Flood = {
      plane: {
        uDim,
        vDim,
        offset: (u, v) => base + u * uStride + v * vStride,
      },
      out,
      visited,
      stack,
    };

    markOutside(flood);
    filled += fillEnclosed(flood);
  }

  return { out, filled };
}
