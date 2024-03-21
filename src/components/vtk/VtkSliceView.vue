<script setup lang="ts">
import { ref, toRefs, provide, markRaw, effectScope, onUnmounted } from 'vue';
import vtkInteractorStyleManipulator from '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator';
import vtkMouseCameraTrackballPanManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballPanManipulator';
import { useVtkView } from '@/src/core/vtk/useVtkView';
import { useImage } from '@/src/composables/useCurrentImage';
import { useVtkInteractorStyle } from '@/src/core/vtk/useVtkInteractorStyle';
import { useVtkInteractionManipulator } from '@/src/core/vtk/useVtkInteractionManipulator';
import { LPSAxisDir } from '@/src/types/lps';
import { useResizeObserver, watchImmediate } from '@vueuse/core';
import { resetCameraToImage, resizeToFitImage } from '@/src/utils/camera';
import { usePersistCameraConfig } from '@/src/composables/usePersistCameraConfig';
import { useAutoFitState } from '@/src/composables/useAutoFitState';
import { Maybe } from '@/src/types';
import { VtkViewApi } from '@/src/types/vtk-types';
import { VtkViewContext } from '@/src/components/vtk/context';
import vtkMouseCameraTrackballZoomToMouseManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomToMouseManipulator';

interface Props {
  viewId: string;
  imageId: Maybe<string>;
  viewDirection: LPSAxisDir;
  viewUp: LPSAxisDir;
  disableAutoResetCamera?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  disableAutoResetCamera: false,
});
const {
  viewId: viewID,
  imageId: imageID,
  viewDirection,
  viewUp,
  disableAutoResetCamera,
} = toRefs(props);

const vtkContainerRef = ref<HTMLElement>();

const { metadata: imageMetadata } = useImage(imageID);

// use a detached scope so that actors can be removed from
// the renderer before the renderer is deleted.
const scope = effectScope(true);
const view = scope.run(() => useVtkView(vtkContainerRef))!;
onUnmounted(() => {
  scope.stop();
});

view.renderer.setBackground(0, 0, 0);
view.renderer.getActiveCamera().setParallelProjection(true);

// setup interactor style
const { interactorStyle } = useVtkInteractorStyle(
  vtkInteractorStyleManipulator,
  view
);

useVtkInteractionManipulator(
  interactorStyle,
  vtkMouseCameraTrackballPanManipulator,
  { button: 1, shift: true }
);
useVtkInteractionManipulator(
  interactorStyle,
  vtkMouseCameraTrackballZoomToMouseManipulator,
  { button: 3 }
);

// bind slice and window configs
// resizeToFit camera controls
const { autoFit, withoutAutoFitEffect } = useAutoFitState(
  view.renderer.getActiveCamera()
);

function autoFitImage() {
  if (!autoFit.value) return;
  withoutAutoFitEffect(() => {
    resizeToFitImage(
      view,
      imageMetadata.value,
      viewDirection.value,
      viewUp.value
    );
  });
}

useResizeObserver(vtkContainerRef, () => {
  if (disableAutoResetCamera.value) return;
  autoFitImage();
});

function resetCamera() {
  autoFit.value = true;
  withoutAutoFitEffect(() => {
    resetCameraToImage(
      view,
      imageMetadata.value,
      viewDirection.value,
      viewUp.value
    );
    autoFitImage();
  });
}

watchImmediate([disableAutoResetCamera, viewID, imageID], ([noAutoReset]) => {
  if (noAutoReset) return;
  resetCamera();
});

// persistent camera config
usePersistCameraConfig(viewID, imageID, view.renderer.getActiveCamera());

// exposed API
const api: VtkViewApi = markRaw({
  ...view,
  interactorStyle,
  resetCamera,
});

defineExpose(api);
provide(VtkViewContext, api);
</script>

<template>
  <div ref="vtkContainerRef"><slot></slot></div>
</template>
