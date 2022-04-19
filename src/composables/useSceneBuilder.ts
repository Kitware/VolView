import vtkAbstractRepresentationProxy from '@kitware/vtk.js/Proxy/Core/AbstractRepresentationProxy';
import { Ref, watchEffect, shallowRef } from '@vue/composition-api';
import { useViewStore } from '../storex/views';
import { vtkLPSViewProxy } from '../types/vtk-types';

interface Scene {
  baseImage?: Ref<string | null>;
}

type RepProxy = vtkAbstractRepresentationProxy;

export function useSceneBuilder<BaseImageType extends RepProxy = RepProxy>(
  viewID: string,
  sceneIDs: Scene
) {
  const viewStore = useViewStore();
  const viewProxy = viewStore.getViewProxy<vtkLPSViewProxy>(viewID);
  if (!viewProxy) {
    throw new Error('[useSceneBuilder] no view proxy');
  }

  const baseImageRep = shallowRef<BaseImageType | null>(null);

  watchEffect(() => {
    viewProxy.removeAllRepresentations();

    baseImageRep.value = null;
    if (sceneIDs.baseImage?.value) {
      const rep = viewStore.getDataRepresentationForView<BaseImageType>(
        sceneIDs.baseImage.value,
        viewID
      );
      baseImageRep.value = rep;
      if (rep) {
        viewProxy.addRepresentation(rep);
      }
    }

    // TODO not sure why I need this, but might as well keep
    // the renderer up to date.
    // For reference, this doesn't get invoked when resetting the
    // camera with a supplied bounds, so we manually invoke it here.
    viewProxy.getRenderer().computeVisiblePropBounds();
  });

  return { baseImageRep };
}
