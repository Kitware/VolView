import { TypedArray } from '@kitware/vtk.js/types';

// 4-connected neighbor offsets, shared so the flood-fill loops never allocate
// a neighbor array per visited voxel.
const NEIGHBOR_DU = [-1, 1, 0, 0];
const NEIGHBOR_DV = [0, 0, -1, 1];

type MaskData = TypedArray | number[];

export type FillHolesOptions = {
  // Flat label-map scalar array, indexed as i + j*dimI + k*dimI*dimJ.
  data: MaskData;
  // Label-map IJK dimensions [dimI, dimJ, dimK].
  dimensions: [number, number, number];
  // IJK axis perpendicular to the fill plane (the slice axis).
  axis: 0 | 1 | 2;
  // When set, only this slice index along `axis` is processed.
  // When omitted, every slice along `axis` is processed.
  sliceIndex?: number;
  // The one label treated as foreground, and the one enclosed background is
  // filled with. Storage is a mask per segment, so a fill is always one
  // segment's own; running over several segments is one call each.
  label: number;
};

// One slice's in-plane coordinate system: its two dimensions and the flat
// offset a plane coordinate maps to.
type Plane = {
  uDim: number;
  vDim: number;
  offset: (u: number, v: number) => number;
};

// Everything a flood fill over one slice works on. `visited` and `stack` are
// reused across slices, so the whole run allocates them once.
// `visited`: 0 = unvisited, 1 = outside (border-connected), 2 = hole.
type Flood = {
  plane: Plane;
  out: MaskData;
  label: number;
  visited: Uint8Array;
  stack: number[];
};

const inPlane = (plane: Plane, u: number, v: number) =>
  u >= 0 && u < plane.uDim && v >= 0 && v < plane.vDim;

// Drain `stack`, expanding the region into unvisited non-foreground neighbors
// (each marked with `mark`). `collect`, when given, receives the flat offset of
// every region cell.
function drain(flood: Flood, mark: number, collect?: number[]) {
  const { plane, out, label, visited, stack } = flood;
  while (stack.length) {
    const p = stack.pop()!;
    const u = p % plane.uDim;
    const v = (p - u) / plane.uDim;
    if (collect) collect.push(plane.offset(u, v));
    for (let n = 0; n < 4; n++) {
      const nu = u + NEIGHBOR_DU[n];
      const nv = v + NEIGHBOR_DV[n];
      if (!inPlane(plane, nu, nv)) continue;
      const np = nu + nv * plane.uDim;
      if (out[plane.offset(nu, nv)] !== label && visited[np] === 0) {
        visited[np] = mark;
        stack.push(np);
      }
    }
  }
}

// Flood the non-foreground cells reachable from the slice border, marking them
// "outside". Whatever it does not reach is enclosed.
function markOutside(flood: Flood) {
  const { plane, out, label, visited, stack } = flood;
  const seed = (u: number, v: number) => {
    const p = u + v * plane.uDim;
    if (visited[p] === 0 && out[plane.offset(u, v)] !== label) {
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
  drain(flood, 1);
}

// Only fill background. A voxel another segment holds is not this segment's to
// take here; the write path decides that on confirm.
function fillBackground(out: MaskData, cells: number[], label: number) {
  for (let c = 0; c < cells.length; c++) {
    if (out[cells[c]] === 0) {
      out[cells[c]] = label;
    }
  }
}

// Any non-foreground cell not marked "outside" is part of a hole. Group each
// hole into a connected component and fill it.
function fillEnclosed(flood: Flood) {
  const { plane, out, label, visited, stack } = flood;
  for (let v = 0; v < plane.vDim; v++) {
    for (let u = 0; u < plane.uDim; u++) {
      const p = u + v * plane.uDim;
      if (visited[p] !== 0 || out[plane.offset(u, v)] === label) continue;

      const holeCells: number[] = [];
      visited[p] = 2;
      stack.push(p);
      drain(flood, 2, holeCells);
      fillBackground(out, holeCells, label);
    }
  }
}

// Fills enclosed background regions ("holes") on 2D slices of a label map.
// A hole is background that does not connect to the slice border. Only
// background (0) voxels are filled. Returns a copy of `data`; the input is left
// untouched.
export function fillHoles(opts: FillHolesOptions) {
  const { data, dimensions, axis, sliceIndex, label } = opts;
  const out = data.slice();

  const strides = [1, dimensions[0], dimensions[0] * dimensions[1]];
  const sliceStride = strides[axis];
  const sliceCount = dimensions[axis];

  // The two in-plane axes (everything that isn't the slice axis).
  const [uAxis, vAxis] = [0, 1, 2].filter((a) => a !== axis);
  const uDim = dimensions[uAxis];
  const vDim = dimensions[vAxis];
  const uStride = strides[uAxis];
  const vStride = strides[vAxis];

  const visited = new Uint8Array(uDim * vDim);
  const stack: number[] = [];

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
      label,
      visited,
      stack,
    };

    markOutside(flood);
    fillEnclosed(flood);
  }

  return out;
}
