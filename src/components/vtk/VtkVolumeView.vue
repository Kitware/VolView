<script setup lang="ts">
import {
  ref,
  toRefs,
  provide,
  watchEffect,
  markRaw,
  effectScope,
  onUnmounted,
} from 'vue';
import { storeToRefs } from 'pinia';
import vtkInteractorStyleManipulator from '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator';
import vtkMouseCameraTrackballPanManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballPanManipulator';
import vtkMouseCameraTrackballZoomManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomManipulator';
import { useVtkView } from '@/src/core/vtk/useVtkView';
import { useImage } from '@/src/composables/useCurrentImage';
import { useViewCameraStore } from '@/src/store/view-configs/camera';
import { useVtkInteractorStyle } from '@/src/core/vtk/useVtkInteractorStyle';
import { useVtkInteractionManipulator } from '@/src/core/vtk/useVtkInteractionManipulator';
import { LPSAxisDir } from '@/src/types/lps';
import { watchImmediate } from '@vueuse/core';
import { resetCameraToImage } from '@/src/utils/camera';
import { usePersistCameraConfig } from '@/src/composables/usePersistCameraConfig';
import { Maybe } from '@/src/types';
import { VtkViewApi } from '@/src/types/vtk-types';
import { VtkViewContext } from '@/src/components/vtk/context';
import vtkMouseCameraTrackballRotateManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballRotateManipulator';
import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';

interface Props {
  viewId: string;
  imageId: Maybe<string>;
  viewDirection: LPSAxisDir;
  viewUp: LPSAxisDir;
}

const props = defineProps<Props>();
const {
  viewId: viewID,
  imageId: imageID,
  viewDirection,
  viewUp,
} = toRefs(props);

const vtkContainerRef = ref<HTMLElement>();

const { disableCameraAutoReset } = storeToRefs(useViewCameraStore());

const { metadata: imageMetadata } = useImage(imageID);

// use a detached scope so that actors can be removed from
// the renderer before the renderer is deleted.
const scope = effectScope(true);
const view = scope.run(() => useVtkView(vtkContainerRef))!;
onUnmounted(() => {
  scope.stop();
});

view.renderer.setBackground(0, 0, 0);

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
  vtkMouseCameraTrackballPanManipulator,
  { button: 2 }
);
useVtkInteractionManipulator(
  interactorStyle,
  vtkMouseCameraTrackballZoomManipulator,
  { button: 3, scrollEnabled: true }
);
useVtkInteractionManipulator(
  interactorStyle,
  vtkMouseCameraTrackballRotateManipulator,
  { button: 1 }
);

// set center of rotation
watchEffect(() => {
  const center = vtkBoundingBox.getCenter(imageMetadata.value.worldBounds);
  interactorStyle.setCenterOfRotation(...center);
});

function resetCamera() {
  resetCameraToImage(
    view,
    imageMetadata.value,
    viewDirection.value,
    viewUp.value
  );
}

watchImmediate([disableCameraAutoReset, viewID, imageID], ([noAutoReset]) => {
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
