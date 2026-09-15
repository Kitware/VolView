import { TypedArray } from '@kitware/vtk.js/types';

// 4-connected neighbor offsets, shared so the flood-fill loops never allocate
// a neighbor array per visited voxel.
const NEIGHBOR_DU = [-1, 1, 0, 0];
const NEIGHBOR_DV = [0, 0, -1, 1];

export type FillHolesOptions = {
  // Flat label-map scalar array, indexed as i + j*dimI + k*dimI*dimJ.
  data: TypedArray | number[];
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
  const planeSize = uDim * vDim;

  // 0 = unvisited, 1 = outside (border-connected non-foreground), 2 = hole.
  const visited = new Uint8Array(planeSize);
  const stack: number[] = [];

  const firstSlice = sliceIndex ?? 0;
  const lastSlice = sliceIndex ?? sliceCount - 1;

  for (let slice = firstSlice; slice <= lastSlice; slice++) {
    const base = slice * sliceStride;
    visited.fill(0);

    const planeOffset = (u: number, v: number) =>
      base + u * uStride + v * vStride;

    // Drain `stack`, expanding the region into unvisited non-foreground
    // neighbors (each marked with `mark`). `collect`, when given, receives the
    // flat offset of every region cell.
    const drain = (mark: number, collect?: number[]) => {
      while (stack.length) {
        const p = stack.pop()!;
        const u = p % uDim;
        const v = (p - u) / uDim;
        if (collect) collect.push(planeOffset(u, v));
        for (let n = 0; n < 4; n++) {
          const nu = u + NEIGHBOR_DU[n];
          const nv = v + NEIGHBOR_DV[n];
          if (nu < 0 || nu >= uDim || nv < 0 || nv >= vDim) continue;
          const np = nu + nv * uDim;
          if (out[planeOffset(nu, nv)] !== label && visited[np] === 0) {
            visited[np] = mark;
            stack.push(np);
          }
        }
      }
    };

    // Flood non-foreground cells reachable from the slice border ("outside").
    const seedOutside = (u: number, v: number) => {
      const p = u + v * uDim;
      if (visited[p] === 0 && out[planeOffset(u, v)] !== label) {
        visited[p] = 1;
        stack.push(p);
      }
    };
    for (let u = 0; u < uDim; u++) {
      seedOutside(u, 0);
      seedOutside(u, vDim - 1);
    }
    for (let v = 0; v < vDim; v++) {
      seedOutside(0, v);
      seedOutside(uDim - 1, v);
    }
    drain(1);

    // Any non-foreground cell not marked "outside" is part of a hole. Group
    // each hole into a connected component and fill it.
    for (let v = 0; v < vDim; v++) {
      for (let u = 0; u < uDim; u++) {
        const p = u + v * uDim;
        if (visited[p] !== 0 || out[planeOffset(u, v)] === label) continue;

        const holeCells: number[] = [];
        visited[p] = 2;
        stack.push(p);
        drain(2, holeCells);

        for (let c = 0; c < holeCells.length; c++) {
          // Only fill background. A voxel another segment holds is not this
          // segment's to take here; the write path decides that on confirm.
          if (out[holeCells[c]] === 0) {
            out[holeCells[c]] = label;
          }
        }
      }
    }
  }

  return out;
}
