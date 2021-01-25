import { unref, watch, watchEffect } from '@vue/composition-api';

import { useProxyManager } from '@/src/composables/proxyManager';

/**
 * Updates the scene.
 * @param {Ref<vtkSourceProxy[]>} sourcesRef
 * @param {Ref<WorldOrientation>} worldOrientationRef
 * @param {Ref<vtkViewProxy>} viewRef
 */
export function watchScene(sourcesRef, worldOrientationRef, viewRef) {
  const pxm = useProxyManager();

  function repopulateScene() {
    const view = unref(viewRef);
    const sources = unref(sourcesRef);
    const worldOrientation = unref(worldOrientationRef);
    if (view) {
      view
        .getRepresentations()
        .forEach((rep) => view.removeRepresentation(rep));

      sources.forEach((source) => {
        const rep = pxm.getRepresentation(source, view);
        if (rep) {
          if (rep.setTransform) {
            rep.setTransform(worldOrientation.worldToIndex);
          }
          view.addRepresentation(rep);
        }
      });
    }
  }

  watch([sourcesRef, viewRef, worldOrientationRef], repopulateScene);

  // trigger this after repopulateScene
  watch(sourcesRef, () => {
    const view = unref(viewRef);
    if (view) {
      view.resetCamera();
      view.renderLater();
    }
  });
}

/**
 * Updates colors for scene objects.
 * @param {Ref<ColorBy>} colorByRef
 * @param {Ref<SceneSources>} sceneSourcesRef
 * @param {Ref<vtkViewProxy>} viewRef
 */
export function watchColorBy(colorByRef, sceneSourcesRef, viewRef) {
  const pxm = useProxyManager();

  function updateColorBy() {
    const view = unref(viewRef);
    const colorBy = unref(colorByRef);
    const sources = unref(sceneSourcesRef);
    if (view) {
      sources.forEach((source, idx) => {
        const colorSrc = colorBy[idx];
        const rep = pxm.getRepresentation(source, view);
        if (rep && colorSrc) {
          const { array, location } = colorSrc;
          rep.setColorBy(array, location);
        }
      });
    }
  }

  watchEffect(updateColorBy);
}
