import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { TypedArray, Vector3 } from '@kitware/vtk.js/types';

import {
  clipExtent,
  extentSize,
  isEmptyExtent,
  maskOffset,
  maskScalars,
  type Extent3D,
} from '@/src/segmentation/model';
import vtkLabelMap from '@/src/vtk/LabelMap';

export const setMaskScalars = (mask: vtkLabelMap, values: Uint8Array) =>
  mask
    .getPointData()
    .setScalars(vtkDataArray.newInstance({ numberOfComponents: 1, values }));

/** Places a bounded mask on the same index grid as its parent image. */
export function placeMask(
  mask: vtkLabelMap,
  parent: vtkImageData,
  extent: Extent3D
) {
  const dimensions = isEmptyExtent(extent) ? [0, 0, 0] : extentSize(extent);
  const origin = isEmptyExtent(extent)
    ? Array.from(parent.getOrigin())
    : Array.from(
        parent.indexToWorld([extent[0], extent[2], extent[4]] as Vector3)
      );
  mask.setOrigin(origin as Vector3);
  mask.setDimensions(dimensions as Vector3);
  mask.computeTransforms();
  return dimensions;
}

export function allocateMask(parent: vtkImageData, extent: Extent3D) {
  const mask = vtkLabelMap.newInstance(
    parent.get('spacing', 'origin', 'direction')
  );
  const dimensions = placeMask(mask, parent, extent);
  setMaskScalars(
    mask,
    new Uint8Array(dimensions[0] * dimensions[1] * dimensions[2])
  );
  return mask;
}

/**
 * Copies a mask onto another extent of its parent grid, padding with zero.
 * An output buffer must match the destination size and not alias the source.
 */
export function reframeMaskScalars(
  scalars: TypedArray | number[],
  from: Extent3D,
  to: Extent3D,
  output?: Uint8Array
) {
  const [mi, mj, mk] = extentSize(to);
  const size = isEmptyExtent(to) ? 0 : mi * mj * mk;
  const values = output ?? new Uint8Array(size);
  if (values.length !== size) throw new Error('Mask output size mismatch');
  if (output) values.fill(0);
  const shared = clipExtent(from, to);
  const [si, sj] = extentSize(from);
  // Bounds can be reactive; read them once before the per-row copy loop.
  const source = { extent: [...from] as Extent3D, mi: si, mj: sj };
  const destination = { extent: [...to] as Extent3D, mi, mj };
  if (isEmptyExtent(shared)) return values;
  const count = shared[1] - shared[0] + 1;
  for (let k = shared[4]; k <= shared[5]; k += 1) {
    for (let j = shared[2]; j <= shared[3]; j += 1) {
      const start = maskOffset(source, shared[0], j, k);
      const end = maskOffset(destination, shared[0], j, k);
      if (count === 1) {
        values[end] = scalars[start];
      } else {
        const row = Array.isArray(scalars)
          ? scalars.slice(start, start + count)
          : scalars.subarray(start, start + count);
        values.set(row, end);
      }
    }
  }
  return values;
}

/** Preserves the vtk image instance while replacing its scalar storage. */
export function regrowMask(
  mask: vtkLabelMap,
  parent: vtkImageData,
  from: Extent3D,
  to: Extent3D
) {
  const previous = maskScalars(mask);
  const values = reframeMaskScalars(previous, from, to);
  placeMask(mask, parent, to);
  setMaskScalars(mask, values);
  mask.modified();
}
