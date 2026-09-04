import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { Vector3 } from '@kitware/vtk.js/types';

import {
  extentSize,
  isEmptyExtent,
  maskOffset,
  maskScalars,
  type Extent3D,
} from '@/src/types/segmentation';
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

/** Preserves the vtk image instance while replacing its scalar storage. */
export function regrowMask(
  mask: vtkLabelMap,
  parent: vtkImageData,
  from: Extent3D,
  to: Extent3D
) {
  const previous = maskScalars(mask);
  const previousSize = extentSize(from);
  const dimensions = placeMask(mask, parent, to);
  const values = new Uint8Array(dimensions[0] * dimensions[1] * dimensions[2]);

  if (!isEmptyExtent(from)) {
    const grown = { extent: to, mi: dimensions[0], mj: dimensions[1] };
    for (let k = 0; k < previousSize[2]; k += 1) {
      for (let j = 0; j < previousSize[1]; j += 1) {
        const source = (j + k * previousSize[1]) * previousSize[0];
        const target = maskOffset(grown, from[0], from[2] + j, from[4] + k);
        values.set(previous.subarray(source, source + previousSize[0]), target);
      }
    }
  }

  setMaskScalars(mask, values);
  mask.modified();
}
