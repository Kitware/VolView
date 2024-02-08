import { useProxyRepresentation } from '@/src/composables/useProxyRepresentations';
import { Maybe } from '@/src/types';
import vtkSliceRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/SliceRepresentationProxy';
import vtkImageMapper from '@kitware/vtk.js/Rendering/Core/ImageMapper';
import { MaybeRef, watchEffect } from 'vue';

export function useBaseSliceRepresentation<
  T extends vtkSliceRepresentationProxy = vtkSliceRepresentationProxy
>(imageID: MaybeRef<Maybe<string>>, viewID: MaybeRef<string>) {
  const { representation } = useProxyRepresentation<T>(imageID, viewID);

  watchEffect(() => {
    const rep = representation.value;
    if (!rep) return;

    const mapper = rep.getMapper() as vtkImageMapper;
    mapper.setResolveCoincidentTopologyToPolygonOffset();
    mapper.setResolveCoincidentTopologyPolygonOffsetParameters(1, 1);
  });

  return { representation };
}
