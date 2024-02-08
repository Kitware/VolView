import { useProxyRepresentations } from '@/src/composables/useProxyRepresentations';
import { Maybe } from '@/src/types';
import vtkSliceRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/SliceRepresentationProxy';
import { MaybeRef } from 'vue';

export function useLayerRepresentations<
  T extends vtkSliceRepresentationProxy = vtkSliceRepresentationProxy
>(dataIDs: MaybeRef<Maybe<Array<Maybe<string>>>>, viewID: MaybeRef<string>) {
  return useProxyRepresentations<T>(dataIDs, viewID);
}
