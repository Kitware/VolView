import { croppingPlanesEqual } from '@/src/store/tools/crop';
import { Maybe } from '@/src/types';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import { watchImmediate } from '@vueuse/core';
import { MaybeRef, toRef } from 'vue';

export function useCroppingEffect(
  mapper: vtkVolumeMapper,
  planes: MaybeRef<Maybe<vtkPlane[]>>
) {
  // TODO make sure that the default planes are based off of spatial extent
  watchImmediate(toRef(planes), (newPlanes, oldPlanes) => {
    if (!newPlanes) return;
    if (oldPlanes && croppingPlanesEqual(newPlanes, oldPlanes)) return;

    mapper.removeAllClippingPlanes();
    newPlanes.forEach((plane) => mapper.addClippingPlane(plane));
  });
}
