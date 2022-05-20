import vtkAbstractRepresentationProxy from '@kitware/vtk.js/Proxy/Core/AbstractRepresentationProxy';
import { Ref, shallowRef, watch } from '@vue/composition-api';
import { useViewStore } from '../store/views';
import { vtkLPSViewProxy } from '../types/vtk-types';

interface Scene {
  baseImage?: Ref<string | null>;
  labelmaps?: Ref<string[]>;
}

type RepProxy = vtkAbstractRepresentationProxy;

export function useSceneBuilder<
  BaseImageType extends RepProxy = RepProxy,
  LabelMapType extends RepProxy = RepProxy
>(viewID: string, sceneIDs: Scene) {
  const viewStore = useViewStore();
  const viewProxy = viewStore.getViewProxy<vtkLPSViewProxy>(viewID);
  if (!viewProxy) {
    throw new Error('[useSceneBuilder] no view proxy');
  }

  const baseImageRep = shallowRef<BaseImageType | null>(null);
  const labelmapReps = shallowRef<LabelMapType[]>([]);

  watch(
    () => [sceneIDs.baseImage?.value, sceneIDs.labelmaps?.value] as const,
    ([baseImageID, labelmapIDs]) => {
      viewProxy.removeAllRepresentations();

      baseImageRep.value = null;
      if (baseImageID) {
        const rep = viewStore.getDataRepresentationForView<BaseImageType>(
          baseImageID,
          viewID
        );
        baseImageRep.value = rep;
        if (rep) {
          viewProxy.addRepresentation(rep);
        }
      }

      labelmapReps.value = [];
      if (labelmapIDs) {
        labelmapIDs.forEach((id) => {
          const rep = viewStore.getDataRepresentationForView<LabelMapType>(
            id,
            viewID
          );
          if (rep) {
            labelmapReps.value.push(rep);
            viewProxy.addRepresentation(rep);
          }
        });
      }

      // TODO not sure why I need this, but might as well keep
      // the renderer up to date.
      // For reference, this doesn't get invoked when resetting the
      // camera with a supplied bounds, so we manually invoke it here.
      viewProxy.getRenderer().computeVisiblePropBounds();
    },
    { immediate: true }
  );

  return { baseImageRep, labelmapReps };
}
