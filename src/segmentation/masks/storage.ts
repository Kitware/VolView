import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { Vector3 } from '@kitware/vtk.js/types';

import { maskScalars } from '@/src/segmentation/model';
import {
  extentSize,
  isEmptyExtent,
  reframeMaskScalars,
  type Extent3D,
} from '@/src/segmentation/geometry';
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
  const empty = isEmptyExtent(extent);
  const dimensions = empty ? [0, 0, 0] : extentSize(extent);
  const origin = Array.from(
    empty
      ? parent.getOrigin()
      : parent.indexToWorld([extent[0], extent[2], extent[4]] as Vector3)
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
  const values = reframeMaskScalars(previous, from, to);
  placeMask(mask, parent, to);
  setMaskScalars(mask, values);
  mask.modified();
}
