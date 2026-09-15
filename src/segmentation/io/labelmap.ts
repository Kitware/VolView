import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { TypedArray } from '@kitware/vtk.js/types';
import vtkLabelMap from '@/src/vtk/LabelMap';
import { fullExtent } from '@/src/segmentation/geometry';
import { placeMask } from '@/src/segmentation/masks/storage';

export const LABELMAP_MAX_VALUE = 65535;
const LABELMAP_BYTE_MAX_VALUE = 255;
export type LabelmapScalars = Uint8Array | Uint16Array;

export const labelmapScalars = (image: vtkImageData) =>
  image.getPointData().getScalars().getData() as LabelmapScalars;

const labelmapArrayType = (maxValue: number) => {
  if (maxValue > LABELMAP_MAX_VALUE) {
    throw new Error(`A labelmap holds at most ${LABELMAP_MAX_VALUE} segments`);
  }
  return maxValue > LABELMAP_BYTE_MAX_VALUE ? Uint16Array : Uint8Array;
};

/** Interchange storage has distinct labels; editable masks remain binary. */
export function allocateLabelmap(parent: vtkImageData, count: number) {
  const ArrayType = labelmapArrayType(count);
  const image = vtkLabelMap.newInstance(
    parent.get('spacing', 'origin', 'direction')
  );
  const dimensions = placeMask(
    image,
    parent,
    fullExtent(parent.getDimensions())
  );
  const values = new ArrayType(dimensions[0] * dimensions[1] * dimensions[2]);
  image
    .getPointData()
    .setScalars(vtkDataArray.newInstance({ numberOfComponents: 1, values }));
  return image;
}

// Number.isInteger also excludes NaN and the infinities.
const isLabelValue = (value: number) =>
  value >= 0 && value <= LABELMAP_MAX_VALUE && Number.isInteger(value);

/** Unsupported values become background instead of wrapping into another segment. */
export function normalizeLabelmapScalars(
  input: number[] | TypedArray
): LabelmapScalars {
  if (input instanceof Uint8Array) return input;
  // Both passes are hot over whole volumes, so they index the input directly.
  // A fresh typed array is already zeroed, so an excluded voxel needs no write.
  const { length } = input;
  let maximum = 0;
  for (let index = 0; index < length; index += 1) {
    const value = input[index];
    if (value > maximum && isLabelValue(value)) maximum = value;
  }
  const ArrayType = labelmapArrayType(maximum);
  if (input instanceof ArrayType) return input;
  const values = new ArrayType(length);
  for (let index = 0; index < length; index += 1) {
    const value = input[index];
    if (isLabelValue(value)) values[index] = value;
  }
  return values;
}
