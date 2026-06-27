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
  // When set, only this label is treated as foreground (selected-segment mode)
  // and enclosed background is filled with it. When omitted, every non-zero
  // voxel is foreground (all-segments mode) and enclosed background is filled
  // with the majority bordering label. In both modes only background (0)
  // voxels are filled, so existing segments are never overwritten.
  label?: number;
  // All-segments mode only: labels that must not be grown. A hole whose
  // majority bordering label is locked is left unfilled rather than expanding a
  // locked segment.
  lockedLabels?: number[];
};

// Fills enclosed background regions ("holes") on 2D slices of a label map.
// A hole is background that does not connect to the slice border. Only
// background (0) voxels are filled; other segments are never overwritten, even
// when enclosed by the foreground. Returns a copy of `data`; the input is left
// untouched.
export function fillHoles(opts: FillHolesOptions) {
  const { data, dimensions, axis, sliceIndex, label, lockedLabels } = opts;
  const out = data.slice();
  const lockedSet = lockedLabels?.length ? new Set(lockedLabels) : null;

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

  const isForeground =
    label === undefined
      ? (value: number) => value !== 0
      : (value: number) => value === label;
  // Only all-segments mode needs to tally each hole's bordering labels.
  const trackBorders = label === undefined;

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
    // flat offset of every region cell; `onBorder`, when given, is called with
    // each bordering foreground label.
    const drain = (
      mark: number,
      collect?: number[],
      onBorder?: (value: number) => void
    ) => {
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
          const nValue = out[planeOffset(nu, nv)];
          if (isForeground(nValue)) {
            onBorder?.(nValue);
          } else if (visited[np] === 0) {
            visited[np] = mark;
            stack.push(np);
          }
        }
      }
    };

    // Flood non-foreground cells reachable from the slice border ("outside").
    const seedOutside = (u: number, v: number) => {
      const p = u + v * uDim;
      if (visited[p] === 0 && !isForeground(out[planeOffset(u, v)])) {
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
        if (visited[p] !== 0 || isForeground(out[planeOffset(u, v)])) continue;

        const holeCells: number[] = [];
        const borderLabelCounts = trackBorders
          ? new Map<number, number>()
          : null;
        visited[p] = 2;
        stack.push(p);
        drain(
          2,
          holeCells,
          borderLabelCounts
            ? (value) =>
                borderLabelCounts.set(
                  value,
                  (borderLabelCounts.get(value) ?? 0) + 1
                )
            : undefined
        );

        let fillValue = label;
        if (fillValue === undefined && borderLabelCounts) {
          // All-segments mode: fill with the majority bordering label, breaking
          // ties by lowest label so the result is deterministic. Never fill
          // with a locked label, which would grow a locked segment.
          let bestCount = 0;
          let bestLabel = -1;
          borderLabelCounts.forEach((count, value) => {
            if (
              count > bestCount ||
              (count === bestCount && value < bestLabel)
            ) {
              bestCount = count;
              bestLabel = value;
            }
          });
          if (bestLabel !== -1 && !lockedSet?.has(bestLabel)) {
            fillValue = bestLabel;
          }
        }
        // fillValue stays undefined only when the hole had no fillable border
        // (no foreground neighbors, or every bordering label is locked).
        if (fillValue !== undefined) {
          for (let c = 0; c < holeCells.length; c++) {
            // Only fill background; never overwrite another segment, even when
            // it is enclosed by the foreground.
            if (out[holeCells[c]] === 0) {
              out[holeCells[c]] = fillValue;
            }
          }
        }
      }
    }
  }

  return out;
}
