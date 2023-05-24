import vtkAbstractRepresentationProxy from '@kitware/vtk.js/Proxy/Core/AbstractRepresentationProxy';
import { computed, Ref, watch } from 'vue';
import { useViewStore } from '../store/views';
import { vtkLPSViewProxy } from '../types/vtk-types';
import { arrayEquals } from '../utils';

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
    const imageID = sceneIDs.baseImage?.value;
    if (!imageID) return null;

    return viewStore.getDataRepresentationForView<BaseImageType>(
      imageID,
      viewID.value
    );
  });

  const labelmapReps = computed(() => {
    const labelmapIDs = sceneIDs.labelmaps?.value ?? [];
    return labelmapIDs
      .map((id) =>
        viewStore.getDataRepresentationForView<LabelMapType>(id, viewID.value)
      )
      .filter(Boolean) as LabelMapType[];
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
    const modelIDs = sceneIDs.models?.value ?? [];
    return modelIDs
      .map((id) =>
        viewStore.getDataRepresentationForView<ModelType>(id, viewID.value)
      )
      .filter(Boolean) as ModelType[];
  });

  type SceneObject = BaseImageType | LabelMapType | LayerType | ModelType;

  const allRepresentations = computed<SceneObject[]>(() => {
    return [
      baseImageRep.value,
      ...labelmapReps.value,
      ...layerReps.value,
      ...modelReps.value,
    ].filter(Boolean) as SceneObject[];
  });

  watch(
    [viewProxy, allRepresentations],
    ([view, reps], [, oldReps]) => {
      if (!view) {
        throw new Error('[useSceneBuilder] No view available');
      }

      if (oldReps && arrayEquals(reps, oldReps)) {
        return;
      }

      view.removeAllRepresentations();
      reps.forEach((rep) => {
        view.addRepresentation(rep);
      });

      // TODO not sure why I need this, but might as well keep
      // the renderer up to date.
      // For reference, this doesn't get invoked when resetting the
      // camera with a supplied bounds, so we manually invoke it here.
      view.getRenderer().computeVisiblePropBounds();
      view.renderLater();
    },
    { immediate: true }
  );

  return { baseImageRep, labelmapReps, layerReps, modelReps };
}
