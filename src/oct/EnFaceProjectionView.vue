<script setup lang="ts">
import {
  computed,
  effectScope,
  onScopeDispose,
  onUnmounted,
  ref,
  toRefs,
  watch,
  watchPostEffect,
} from 'vue';
import { useResizeObserver } from '@vueuse/core';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkInteractorStyleManipulator from '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator';
import vtkMouseCameraTrackballPanManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballPanManipulator';
import vtkMouseCameraTrackballZoomToMouseManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomToMouseManipulator';
import vtkMouseRangeManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseRangeManipulator';
import { useVtkView } from '@/src/core/vtk/useVtkView';
import { useVtkInteractorStyle } from '@/src/core/vtk/useVtkInteractorStyle';
import { useVtkInteractionManipulator } from '@/src/core/vtk/useVtkInteractionManipulator';
import { useSliceRepresentation } from '@/src/core/vtk/useSliceRepresentation';
import { useMouseRangeManipulatorListener } from '@/src/core/vtk/useMouseRangeManipulatorListener';
import { useVTKMultiWorldToSVG } from '@/src/composables/useVTKWorldToDisplay';
import { useAutoFitState } from '@/src/composables/useAutoFitState';
import { usePersistCameraConfig } from '@/src/composables/usePersistCameraConfig';
import { useWebGLWatchdog } from '@/src/composables/useWebGLWatchdog';
import { useResetViewsEvents } from '@/src/components/tools/ResetViews.vue';
import { useViewCameraStore } from '@/src/store/view-configs/camera';
import { useWindowingStore } from '@/src/store/view-configs/windowing';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import { resizeToFit } from '@/src/utils/camera';
import type { Vector3 } from '@kitware/vtk.js/types';
import type { Maybe } from '@/src/types';

const props = defineProps<{
  viewId: string;
  imageId: Maybe<string>;
  frame: {
    width: number;
    height: number;
    spacing: number[];
    pixels: Uint8Array;
  } | null;
  windowRange: { min: number; max: number };
  windowConfig: { width: number; level: number };
}>();
const { frame, viewId, imageId } = toRefs(props);
const container = ref<HTMLElement>();
const scope = effectScope(true);
const view = scope.run(() => useVtkView(container))!;
onUnmounted(() => scope.stop());
useWebGLWatchdog(view);
const camera = view.renderer.getActiveCamera();
camera.setParallelProjection(true);
view.renderer.setBackground(0, 0, 0);
const { interactorStyle } = useVtkInteractorStyle(
  vtkInteractorStyleManipulator,
  view
);
const tools = useToolStore();
for (const config of [{ button: 1, shift: true }, { button: 2 }])
  useVtkInteractionManipulator(
    interactorStyle,
    vtkMouseCameraTrackballPanManipulator,
    config
  );
useVtkInteractionManipulator(
  interactorStyle,
  vtkMouseCameraTrackballPanManipulator,
  computed(() => ({ button: tools.currentTool === Tools.Pan ? 1 : -1 }))
);
useVtkInteractionManipulator(
  interactorStyle,
  vtkMouseCameraTrackballZoomToMouseManipulator,
  { button: 3, scrollEnabled: true }
);
useVtkInteractionManipulator(
  interactorStyle,
  vtkMouseCameraTrackballZoomToMouseManipulator,
  computed(() => ({ button: tools.currentTool === Tools.Zoom ? 1 : -1 }))
);
const { instance: windowManipulator } = useVtkInteractionManipulator(
  interactorStyle,
  vtkMouseRangeManipulator,
  computed(() => ({
    button: tools.currentTool === Tools.WindowLevel ? 1 : -1,
    dragEnabled: true,
  }))
);
const windowing = useWindowingStore();
const rangeStep = computed(
  () => Math.min(props.windowRange.max - props.windowRange.min || 1, 1) / 256
);
for (const [direction, field] of [
  ['horizontal', 'level'],
  ['vertical', 'width'],
] as const) {
  const value = useMouseRangeManipulatorListener(
    windowManipulator,
    direction,
    computed(() =>
      field === 'level'
        ? [props.windowRange.min, props.windowRange.max]
        : [1e-12, props.windowRange.max - props.windowRange.min || 1]
    ),
    rangeStep,
    props.windowConfig[field],
    1,
    () => {
      if (props.imageId)
        windowing.updateConfig(
          props.viewId,
          props.imageId,
          { [field]: value.value },
          true
        );
    }
  );
  watch(
    () => props.windowConfig[field],
    (incoming) => {
      value.value = incoming;
    }
  );
}

const image = vtkImageData.newInstance();
const scalars = vtkDataArray.newInstance({
  numberOfComponents: 4,
  values: new Uint8Array(4),
});
image.getPointData().setScalars(scalars);
const representation = useSliceRepresentation(
  view,
  computed(() => (frame.value ? image : null))
);
representation.mapper.setSlicingMode(2);
representation.mapper.setSlice(0);
representation.property.setIndependentComponents(false);
representation.property.setColorWindow(255);
representation.property.setColorLevel(127.5);
representation.property.setInterpolationTypeToNearest();
onScopeDispose(() => {
  image.delete();
  scalars.delete();
});
watch(
  frame,
  (incoming) => {
    if (!incoming) return;
    const { width, height, spacing, pixels } = incoming;
    image.setDimensions(width, height, 1);
    image.setSpacing([spacing[0], spacing[1], 1]);
    image.setOrigin([spacing[0] / 2, spacing[1] / 2, 0]);
    scalars.setData(pixels, 4);
    image.modified();
    view.requestRender();
  },
  { immediate: true }
);

const autoFit = useAutoFitState(camera);
const cameras = useViewCameraStore();
const cameraDataId = computed(() =>
  cameras.isCameraInitialized(viewId.value, imageId.value)
    ? imageId.value
    : undefined
);
// Restore the camera before calculating the projected image's clip range.
usePersistCameraConfig(viewId, cameraDataId, camera);
function fitImage() {
  const current = frame.value;
  if (!current || !autoFit.autoFit.value) return;
  autoFit.withPaused(() =>
    resizeToFit(view, 2, 1, [
      current.width * current.spacing[0],
      current.height * current.spacing[1],
      1,
    ])
  );
  view.requestRender();
}
function resetCamera() {
  const current = frame.value;
  if (!current) return;
  const x = (current.width * current.spacing[0]) / 2;
  const y = (current.height * current.spacing[1]) / 2;
  autoFit.autoFit.value = true;
  autoFit.withPaused(() => {
    camera.setFocalPoint(x, y, 0);
    camera.setPosition(x, y, -1);
    camera.setViewUp(0, -1, 0);
    view.renderer.resetCameraClippingRange();
    fitImage();
  });
}
let imageGeometry = '';
let cameraImageId: Maybe<string>;
watch(
  [frame, imageId],
  ([current, currentImageId]) => {
    if (!current) return;
    const geometry = [current.width, current.height, ...current.spacing].join(
      ','
    );
    const sameImage = currentImageId === cameraImageId;
    if (sameImage && geometry === imageGeometry) return;
    if (
      !cameras.isCameraInitialized(viewId.value, currentImageId) ||
      (sameImage && imageGeometry && geometry !== imageGeometry)
    ) {
      resetCamera();
      cameras.markCameraAsInitialized(viewId.value, currentImageId);
    } else {
      autoFit.autoFit.value = false;
      view.renderer.resetCameraClippingRange();
      view.requestRender();
    }
    cameraImageId = currentImageId;
    imageGeometry = geometry;
  },
  { immediate: true }
);
useResizeObserver(container, fitImage);
const resets = useResetViewsEvents().onClick(resetCamera);
onScopeDispose(resets.off);
watchPostEffect(() => {
  const canvas = view.renderWindowView.getCanvas();
  canvas?.setAttribute('data-testid', 'oct-en-face-canvas');
  canvas?.setAttribute('aria-label', 'OCT en face projection');
});
const corners = useVTKMultiWorldToSVG(
  computed(() =>
    frame.value
      ? ([
          [0, 0, 0],
          [frame.value.spacing[0], 0, 0],
          [0, frame.value.spacing[1], 0],
        ] as Vector3[])
      : null
  ),
  view.renderer
);
const imageTransform = computed(() => {
  if (corners.value?.length !== 3) return '';
  const [origin, x, y] = corners.value;
  return `matrix(${x[0] - origin[0]},${x[1] - origin[1]},${y[0] - origin[0]},${y[1] - origin[1]},${origin[0]},${origin[1]})`;
});
</script>

<template>
  <div class="projection-view">
    <div
      ref="container"
      class="vtk-view"
      @pointerdown.capture="autoFit.resume"
      @pointerup.capture="autoFit.pause"
      @wheel.capture="autoFit.autoFit.value = false"
    />
    <slot :image-transform="imageTransform" />
  </div>
</template>

<style scoped>
.projection-view,
.vtk-view {
  position: absolute;
  inset: 0;
}
</style>
