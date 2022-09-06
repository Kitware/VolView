import vtkAbstractRepresentationProxy from '@kitware/vtk.js/Proxy/Core/AbstractRepresentationProxy';
import { Ref, shallowRef, watch } from '@vue/composition-api';
import { useViewStore } from '../store/views';
import { vtkLPSViewProxy } from '../types/vtk-types';

interface Scene {
  baseImage?: Ref<string | null>;
  labelmaps?: Ref<string[]>;
  models?: Ref<string[]>;
}

type RepProxy = vtkAbstractRepresentationProxy;

export function useSceneBuilder<
  BaseImageType extends RepProxy = RepProxy,
  LabelMapType extends RepProxy = RepProxy,
  ModelType extends RepProxy = RepProxy
>(viewID: string, sceneIDs: Scene) {
  const viewStore = useViewStore();
  const viewProxy = viewStore.getViewProxy<vtkLPSViewProxy>(viewID);
  if (!viewProxy) {
    throw new Error('[useSceneBuilder] no view proxy');
  }

  const baseImageRep = shallowRef<BaseImageType | null>(null);
  const labelmapReps = shallowRef<LabelMapType[]>([]);
  const modelReps = shallowRef<ModelType[]>([]);

  if (sceneIDs.baseImage) {
    watch(
      sceneIDs.baseImage,
      (baseImageID) => {
        baseImageRep.value = null;
        if (baseImageID) {
          const rep = viewStore.getDataRepresentationForView<BaseImageType>(
            baseImageID,
            viewID
          );
          baseImageRep.value = rep;
          if (rep) {
            rep.setRescaleOnColorBy(false);
          }
        }
      },
      { immediate: true }
    );
  }

  if (sceneIDs.labelmaps) {
    watch(
      sceneIDs.labelmaps,
      (labelmapIDs) => {
        labelmapReps.value = [];
        if (labelmapIDs) {
          labelmapIDs
            .map((id) =>
              viewStore.getDataRepresentationForView<LabelMapType>(id, viewID)
            )
            .filter(Boolean)
            .forEach((rep) => labelmapReps.value.push(rep!));
        }
      },
      { immediate: true }
    );
  }

  if (sceneIDs.models) {
    watch(
      sceneIDs.models,
      (modelIDs) => {
        modelReps.value = [];
        if (modelIDs) {
          console.log(
            modelIDs.map((id) =>
              viewStore.getDataRepresentationForView<ModelType>(id, viewID)
            )
          );
          modelIDs
            .map((id) =>
              viewStore.getDataRepresentationForView<ModelType>(id, viewID)
            )
            .filter(Boolean)
            .forEach((rep) => modelReps.value.push(rep!));
        }
      },
      { immediate: true }
    );
  }

  watch(
    () => [baseImageRep.value, labelmapReps.value, modelReps.value] as const,
    ([baseRep, lmReps, mReps]) => {
      viewProxy.removeAllRepresentations();

      if (baseRep) {
        viewProxy.addRepresentation(baseRep);
      }

      if (lmReps?.length) {
        lmReps.forEach((rep) => viewProxy.addRepresentation(rep));
      }

      if (mReps?.length) {
        mReps.forEach((rep) => viewProxy.addRepresentation(rep));
      }

      // TODO not sure why I need this, but might as well keep
      // the renderer up to date.
      // For reference, this doesn't get invoked when resetting the
      // camera with a supplied bounds, so we manually invoke it here.
      viewProxy.getRenderer().computeVisiblePropBounds();
      viewProxy.render();
    },
    { deep: true, immediate: true }
  );

  return { baseImageRep, labelmapReps };
}
