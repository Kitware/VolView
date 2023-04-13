import vtkAbstractRepresentationProxy from '@kitware/vtk.js/Proxy/Core/AbstractRepresentationProxy';
import { computed, Ref, watch } from 'vue';
import { useViewStore } from '../store/views';
import { vtkLPSViewProxy } from '../types/vtk-types';

interface Scene {
  baseImage?: Ref<string | null>;
  labelmaps?: Ref<string[]>;
  layers?: Ref<string[]>;
  models?: Ref<string[]>;
}

type RepProxy = vtkAbstractRepresentationProxy;

export function useSceneBuilder<
  BaseImageType extends RepProxy = RepProxy,
  LabelMapType extends RepProxy = RepProxy,
  LayerType extends RepProxy = RepProxy,
  ModelType extends RepProxy = RepProxy
>(viewID: Ref<string>, sceneIDs: Scene) {
  const viewStore = useViewStore();
  const viewProxy = computed(() =>
    viewStore.getViewProxy<vtkLPSViewProxy>(viewID.value)
  );

  const baseImageRep = computed(() => {
    const _viewID = viewID.value;
    if (sceneIDs.baseImage) {
      const imageID = sceneIDs.baseImage.value;
      if (imageID) {
        return viewStore.getDataRepresentationForView<BaseImageType>(
          imageID,
          _viewID
        );
      }
    }
    return null;
  });

  const labelmapReps = computed(() => {
    const _viewID = viewID.value;
    if (sceneIDs.labelmaps) {
      const labelmapIDs = sceneIDs.labelmaps.value;
      if (labelmapIDs) {
        return labelmapIDs
          .map((id) =>
            viewStore.getDataRepresentationForView<LabelMapType>(id, _viewID)
          )
          .filter(Boolean) as LabelMapType[];
      }
    }
    return [];
  });

  const layerReps = computed(
    () =>
      (sceneIDs.layers?.value ?? [])
        .map((id) =>
          viewStore.getDataRepresentationForView<LayerType>(id, viewID.value)
        )
        .filter(Boolean) as LayerType[]
  );

  const modelReps = computed(() => {
    const _viewID = viewID.value;
    if (sceneIDs.models) {
      const modelIDs = sceneIDs.models.value;
      if (modelIDs) {
        return modelIDs
          .map((id) =>
            viewStore.getDataRepresentationForView<ModelType>(id, _viewID)
          )
          .filter(Boolean) as ModelType[];
      }
    }
    return [];
  });

  watch(
    [viewProxy, baseImageRep, labelmapReps, layerReps, modelReps],
    ([view, baseRep, lmReps, layReps, mReps]) => {
      if (!view) {
        throw new Error('[useSceneBuilder] No view available');
      }

      view.removeAllRepresentations();

      if (baseRep) {
        // we control the color mapping range manually
        baseRep.setRescaleOnColorBy(false);
        view.addRepresentation(baseRep);
      }
      [...lmReps, ...layReps, ...mReps].forEach((rep) =>
        view.addRepresentation(rep)
      );

      // TODO not sure why I need this, but might as well keep
      // the renderer up to date.
      // For reference, this doesn't get invoked when resetting the
      // camera with a supplied bounds, so we manually invoke it here.
      view.getRenderer().computeVisiblePropBounds();
      view.render();
    },
    { deep: true, immediate: true }
  );

  return { baseImageRep, labelmapReps, layerReps, modelReps };
}
