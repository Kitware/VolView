import { MaybeRef } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkImageMapper from '@kitware/vtk.js/Rendering/Core/ImageMapper';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import { useVtkRepresentation } from '@/src/core/vtk/useVtkRepresentation';
import { Maybe } from '@/src/types';
import { View } from '@/src/core/vtk/useVtkView';

export function useSliceRepresentation(
  view: View,
  imageData: MaybeRef<Maybe<vtkImageData>>
) {
  const sliceRep = useVtkRepresentation({
    view,
    data: imageData,
    vtkActorClass: vtkImageSlice,
    vtkMapperClass: vtkImageMapper,
  });

  return sliceRep;
}
