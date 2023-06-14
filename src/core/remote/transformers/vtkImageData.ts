import vtk from '@kitware/vtk.js/vtk';
import { TypedArrayConstructorName } from '@/src/types';
import { TypedArrayConstructorNames } from '@/src/utils';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

const AllowedTypedArrays = new Set(TypedArrayConstructorNames);

function isTypedArrayName(name: string): name is TypedArrayConstructorName {
  return AllowedTypedArrays.has(name);
}

function isImageData(obj: any): obj is vtkImageData {
  return obj?.isA?.('vtkImageData');
}

function wrapValuesInTypedArray(serializedImageData: any) {
  // convert data values to a typed array for smaller packets.
  const { arrays } = serializedImageData.pointData;
  arrays.forEach((da: any) => {
    const { data } = da;
    if (isTypedArrayName(data.dataType)) {
      data.values = new globalThis[data.dataType as TypedArrayConstructorName](
        data.values
      );
    }
  });
  return serializedImageData;
}

export function serializeVtkImageData(obj: any): any {
  if (!isImageData(obj)) {
    return obj;
  }

  const serialized = obj.toJSON() as any;
  return wrapValuesInTypedArray(serialized);
}

export function deserializeVtkImageData(obj: any) {
  if (obj?.vtkClass !== 'vtkImageData') {
    return obj;
  }

  try {
    return vtk(wrapValuesInTypedArray(obj));
  } catch (e) {
    return obj;
  }
}
