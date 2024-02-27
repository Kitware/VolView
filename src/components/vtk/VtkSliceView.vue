<script setup lang="ts">
import { ref, toRefs, computed, provide, markRaw } from 'vue';
import vtkInteractorStyleManipulator from '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator';
import vtkMouseCameraTrackballPanManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballPanManipulator';
import vtkMouseRangeManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseRangeManipulator';
import { useVtkView } from '@/src/core/vtk/useVtkView';
import { useImage } from '@/src/composables/useCurrentImage';
import { useVtkInteractorStyle } from '@/src/core/vtk/useVtkInteractorStyle';
import { useVtkInteractionManipulator } from '@/src/core/vtk/useVtkInteractionManipulator';
import { useMouseRangeManipulatorListener } from '@/src/core/vtk/useMouseRangeManipulatorListener';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import { useSliceConfigInitializer } from '@/src/composables/useSliceConfigInitializer';
import { useWindowingConfig } from '@/src/composables/useWindowingConfig';
import { useWindowingConfigInitializer } from '@/src/composables/useWindowingConfigInitializer';
import { LPSAxisDir } from '@/src/types/lps';
import type { Vector2 } from '@kitware/vtk.js/types';
import { syncRef, useResizeObserver, watchImmediate } from '@vueuse/core';
import { resetCameraToImage, resizeToFitImage } from '@/src/utils/camera';
import { usePersistCameraConfig } from '@/src/composables/usePersistCameraConfigNew';
import { useAutoFitState } from '@/src/composables/useAutoFitState';
import { Maybe } from '@/src/types';
import { VtkViewApi } from '@/src/types/vtk-types';
import { VtkViewContext } from '@/src/components/vtk/context';
import vtkMouseCameraTrackballZoomToMouseManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomToMouseManipulator';
import type { vtkRange } from '@kitware/vtk.js/interfaces';

interface Props {
  viewId: string;
  imageId: Maybe<string>;
  viewDirection: LPSAxisDir;
  viewUp: LPSAxisDir;
  disableAutoResetCamera?: boolean;
  sliceRange?: vtkRange;
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
  sliceRange,
} = toRefs(props);

const vtkContainerRef = ref<HTMLElement>();

const { metadata: imageMetadata } = useImage(imageID);

const view = useVtkView(vtkContainerRef);
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
const { instance: rangeManipulator } = useVtkInteractionManipulator(
  interactorStyle,
  vtkMouseRangeManipulator,
  { button: 1, dragEnabled: true, scrollEnabled: true }
);

// initialize and bind slice and window configs
const sliceConfig = useSliceConfig(viewID, imageID);
const wlConfig = useWindowingConfig(viewID, imageID);

const computeStep = (range: Vector2) => {
  return Math.min(range[1] - range[0], 1) / 256;
};
const wlStep = computed(() => computeStep(wlConfig.range.value));

useSliceConfigInitializer(viewID, imageID, viewDirection, sliceRange?.value);
useWindowingConfigInitializer(viewID, imageID);

const horiz = useMouseRangeManipulatorListener(
  rangeManipulator,
  'horizontal',
  wlConfig.range,
  wlStep,
  wlConfig.level.value
);

const vert = useMouseRangeManipulatorListener(
  rangeManipulator,
  'vertical',
  computed(() => [1e-12, wlConfig.range.value[1] - wlConfig.range.value[0]]),
  wlStep,
  wlConfig.width.value
);

const scroll = useMouseRangeManipulatorListener(
  rangeManipulator,
  'scroll',
  sliceConfig.range,
  1,
  sliceConfig.slice.value
);

syncRef(horiz, wlConfig.level, { immediate: true });
syncRef(vert, wlConfig.width, { immediate: true });
syncRef(scroll, sliceConfig.slice, { immediate: true });

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
