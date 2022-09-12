import vtkAbstractRepresentationProxy from '@kitware/vtk.js/Proxy/Core/AbstractRepresentationProxy';
import { computed, Ref, shallowRef, watch } from '@vue/composition-api';
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
>(viewID: Ref<string>, sceneIDs: Scene) {
  const viewStore = useViewStore();
  const viewProxy = computed(() =>
    viewStore.getViewProxy<vtkLPSViewProxy>(viewID.value)
  );

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
            viewID.value
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
              viewStore.getDataRepresentationForView<LabelMapType>(
                id,
                viewID.value
              )
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
          modelIDs
            .map((id) =>
              viewStore.getDataRepresentationForView<ModelType>(
                id,
                viewID.value
              )
            )
            .filter(Boolean)
            .forEach((rep) => modelReps.value.push(rep!));
        }
      },
      { immediate: true }
    );
  }

  watch(
    () =>
      [
        viewProxy.value,
        baseImageRep.value,
        labelmapReps.value,
        modelReps.value,
      ] as const,
    ([view, baseRep, lmReps, mReps]) => {
      if (!view) {
        throw new Error('[useSceneBuilder] No view available');
      }

      view.removeAllRepresentations();

      if (baseRep) {
        view.addRepresentation(baseRep);
      }

      if (lmReps?.length) {
        lmReps.forEach((rep) => view.addRepresentation(rep));
      }

      if (mReps?.length) {
        mReps.forEach((rep) => view.addRepresentation(rep));
      }

      // TODO not sure why I need this, but might as well keep
      // the renderer up to date.
      // For reference, this doesn't get invoked when resetting the
      // camera with a supplied bounds, so we manually invoke it here.
      view.getRenderer().computeVisiblePropBounds();
      view.render();
    },
    { deep: true, immediate: true }
  );

  return { baseImageRep, labelmapReps };
}
