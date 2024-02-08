import { useProxyRepresentations } from '@/src/composables/useProxyRepresentations';
import { Maybe } from '@/src/types';
import vtkLabelMapSliceRepProxy from '@/src/vtk/LabelMapSliceRepProxy';
import { MaybeRef } from 'vue';

export function useLabelMapRepresentations<
  T extends vtkLabelMapSliceRepProxy = vtkLabelMapSliceRepProxy
>(dataIDs: MaybeRef<Maybe<Array<Maybe<string>>>>, viewID: MaybeRef<string>) {
  return useProxyRepresentations<T>(dataIDs, viewID);
}
