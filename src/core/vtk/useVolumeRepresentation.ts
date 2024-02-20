import { MaybeRef } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { useVtkRepresentation } from '@/src/core/vtk/useVtkRepresentation';
import { Maybe } from '@/src/types';
import { View } from '@/src/core/vtk/useVtkView';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';

export function useVolumeRepresentation(
  view: View,
  imageData: MaybeRef<Maybe<vtkImageData>>
) {
  const volRep = useVtkRepresentation({
    view,
    data: imageData,
    vtkActorClass: vtkVolume,
    vtkMapperClass: vtkVolumeMapper,
  });

  return volRep;
}
