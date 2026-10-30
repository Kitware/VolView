<script setup lang="ts">
import {
  computed,
  ref,
  toRefs,
  provide,
  markRaw,
  effectScope,
  onUnmounted,
} from 'vue';
import { storeToRefs } from 'pinia';
import vtkInteractorStyleManipulator from '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator';
import { useVtkView } from '@/src/core/vtk/useVtkView';
import { useImage } from '@/src/composables/useCurrentImage';
import { useVtkInteractorStyle } from '@/src/core/vtk/useVtkInteractorStyle';
import { LPSAxisDir } from '@/src/types/lps';
import { useResizeObserver, watchImmediate } from '@vueuse/core';
import { resetCameraToImage, resizeToFitImage } from '@/src/utils/camera';
import { usePersistCameraConfig } from '@/src/composables/usePersistCameraConfig';
import { useAutoFitState } from '@/src/composables/useAutoFitState';
import { Maybe } from '@/src/types';
import { VtkViewApi } from '@/src/types/vtk-types';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useViewCameraStore } from '@/src/store/view-configs/camera';
import type { ImageMetadata } from '@/src/types/image';
import { getLPSDirections } from '@/src/utils/lps';
import { vec3 } from 'gl-matrix';

type Props = {
  viewId: string;
  imageId: Maybe<string>;
  viewDirection: LPSAxisDir;
  viewUp: LPSAxisDir;
  renderGeometry?: { metadata: ImageMetadata | null; fitKey: string };
  zoomOnScroll?: boolean;
};

const props = defineProps<Props>();
const {
  viewId: viewID,
  imageId: imageID,
  viewDirection,
  viewUp,
} = toRefs(props);

const vtkContainerRef = ref<HTMLElement>();
const viewCameraStore = useViewCameraStore();
const { disableCameraAutoReset } = storeToRefs(viewCameraStore);

const { metadata: sourceMetadata } = useImage(imageID);
const imageMetadata = computed(() =>
  props.renderGeometry === undefined
    ? sourceMetadata.value
    : props.renderGeometry.metadata
);

// use a detached scope so that actors can be removed from
// the renderer before the renderer is deleted.
const scope = effectScope(true);
const view = scope.run(() =>
  useVtkView(vtkContainerRef, {
    separateImageLayer: true,
    clippingBounds: computed(() => imageMetadata.value?.worldBounds),
  })
)!;

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
// Camera manipulators fit clipping to image bounds; widgets pick the upper layer.
interactorStyle.setFocusedRenderer(view.imageRenderer);

// bind slice and window configs
// resizeToFit camera controls
const autoFitEnabled = computed({
  get: () =>
    viewCameraStore.getConfig(viewID.value, imageID.value)?.autoFit ?? true,
  set: (autoFit) => {
    if (imageID.value) {
      viewCameraStore.updateConfig(viewID.value, imageID.value, { autoFit });
    }
  },
});

const autoFit = useAutoFitState(
  view.renderer.getActiveCamera(),
  autoFitEnabled
);

function autoFitImage() {
  const metadata = imageMetadata.value;
  if (!autoFit.autoFit.value || !metadata) return;
  autoFit.withPaused(() => {
    resizeToFitImage(view, metadata, viewDirection.value, viewUp.value);
  });
}

useResizeObserver(vtkContainerRef, () => {
  if (disableCameraAutoReset.value) return;
  autoFitImage();
});

function resetCamera() {
  const metadata = imageMetadata.value;
  if (!metadata) return;
  autoFit.autoFit.value = true;
  autoFit.withPaused(() => {
    resetCameraToImage(view, metadata, viewDirection.value, viewUp.value);
    autoFitImage();
  });
  viewCameraStore.markCameraAsInitialized(viewID.value, imageID.value);
}

let previousGeometry: {
  viewId: string;
  imageId: Maybe<string>;
  key?: string;
  direction: LPSAxisDir;
  up: LPSAxisDir;
};
const isPreviousImage = (viewId: string, imageId: Maybe<string>) =>
  previousGeometry?.viewId === viewId && previousGeometry.imageId === imageId;
const projectionOrientationChanged = (direction: LPSAxisDir, up: LPSAxisDir) =>
  !!props.renderGeometry &&
  (previousGeometry.direction !== direction || previousGeometry.up !== up);
watchImmediate(
  [
    viewID,
    imageID,
    disableCameraAutoReset,
    imageMetadata,
    () => props.renderGeometry?.fitKey,
    viewDirection,
    viewUp,
  ],
  ([viewID_, imageID_, noAutoReset, metadata, geometryKey, direction, up]) => {
    if (!metadata) return;
    const sameImage = isPreviousImage(viewID_, imageID_);
    const geometryChanged = sameImage && previousGeometry.key !== geometryKey;
    if (
      imageID_ &&
      (!viewCameraStore.isCameraInitialized(viewID_, imageID_) ||
        geometryChanged) &&
      !noAutoReset
    ) {
      resetCamera();
    } else if (
      noAutoReset &&
      sameImage &&
      projectionOrientationChanged(direction, up)
    ) {
      // A new projection plane still needs a facing camera; keep pan and zoom.
      autoFit.withPaused(() => {
        const camera = view.renderer.getActiveCamera();
        const focalPoint = [...camera.getFocalPoint()];
        const directions = getLPSDirections(metadata.orientation);
        const normal = vec3.normalize([0, 0, 0], directions[direction]);
        camera.setPositionAndFocalPoint(
          focalPoint.map(
            (value, axis) => value - camera.getDistance() * normal[axis]
          ),
          focalPoint
        );
        const vertical = directions[up];
        camera.setViewUp(vertical[0], vertical[1], vertical[2]);
        view.renderer.resetCameraClippingRange(metadata.worldBounds);
        view.requestRender();
      });
    }
    previousGeometry = {
      viewId: viewID_,
      imageId: imageID_,
      key: geometryKey,
      direction,
      up,
    };
  }
);

// Must run before the clipping-range watcher below: resetCameraClippingRange
// computes near/far from the camera's current position, so on remount the
// saved position must be syncRef'd back first or the slice falls outside
// the clip volume and the canvas goes black.
usePersistCameraConfig(viewID, imageID, view.renderer.getActiveCamera());

watchImmediate([imageMetadata, disableCameraAutoReset], () => {
  const metadata = imageMetadata.value;
  if (!metadata) return;
  if (
    viewCameraStore.isCameraInitialized(viewID.value, imageID.value) ||
    disableCameraAutoReset.value
  ) {
    view.renderer.resetCameraClippingRange(metadata.worldBounds);
  }
});

// exposed API
const api: VtkViewApi = markRaw({
  ...view,
  interactorStyle,
  resetCamera,
});

defineExpose(api);
provide(VtkViewContext, api);

function onPointerDown() {
  autoFit.resume();
}

function onPointerUp() {
  autoFit.pause();
}
</script>

<template>
  <div>
    <div
      ref="vtkContainerRef"
      class="view"
      @pointerdown.capture="onPointerDown"
      @pointerup.capture="onPointerUp"
      @wheel.capture="zoomOnScroll && (autoFit.autoFit.value = false)"
    />
    <slot></slot>
  </div>
</template>

<style scoped>
.view {
  width: 100%;
  height: 100%;
}
</style>
