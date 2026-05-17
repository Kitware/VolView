<template>
  <div
    class="vtk-container-wrapper"
    tabindex="0"
    @pointerenter="hover = true"
    @pointerleave="hover = false"
    @focusin="hover = true"
    @focusout="hover = false"
  >
    <div class="vtk-gutter mt-1">
      <v-btn dark icon size="medium" variant="text" @click="resetCamera">
        <v-icon size="medium" class="py-1">mdi-camera-flip-outline</v-icon>
        <v-tooltip
          location="right"
          activator="parent"
          transition="slide-x-transition"
        >
          Reset Camera
        </v-tooltip>
      </v-btn>
      <slice-slider
        v-model="currentFrame"
        class="slice-slider"
        :min="frameRange[0]"
        :max="frameRange[1]"
        :step="1"
        :handle-height="20"
      />
    </div>
    <div class="vtk-container" data-testid="two-view-container">
      <v-progress-linear
        v-if="isImageLoading"
        indeterminate
        class="loading-indicator"
        height="2"
        color="grey"
      />
      <div class="vtk-sub-container">
        <vtk-slice-view
          class="vtk-view"
          ref="vtkView"
          data-testid="vtk-view vtk-cine-view"
          :view-id="viewId"
          :image-id="currentImageID"
          :view-direction="VIEW_DIRECTION"
          :view-up="VIEW_UP"
        >
          <vtk-mouse-interaction-manipulator
            v-if="currentTool === Tools.Pan"
            :manipulator-constructor="vtkMouseCameraTrackballPanManipulator"
            :manipulator-props="{ button: 1 }"
          ></vtk-mouse-interaction-manipulator>
          <vtk-mouse-interaction-manipulator
            :manipulator-constructor="vtkMouseCameraTrackballPanManipulator"
            :manipulator-props="{ button: 1, shift: true }"
          ></vtk-mouse-interaction-manipulator>
          <vtk-mouse-interaction-manipulator
            :manipulator-constructor="vtkMouseCameraTrackballPanManipulator"
            :manipulator-props="{ button: 2 }"
          ></vtk-mouse-interaction-manipulator>
          <vtk-mouse-interaction-manipulator
            v-if="currentTool === Tools.Zoom"
            :manipulator-constructor="
              vtkMouseCameraTrackballZoomToMouseManipulator
            "
            :manipulator-props="{ button: 1 }"
          ></vtk-mouse-interaction-manipulator>
          <vtk-mouse-interaction-manipulator
            :manipulator-constructor="
              vtkMouseCameraTrackballZoomToMouseManipulator
            "
            :manipulator-props="{ button: 3 }"
          ></vtk-mouse-interaction-manipulator>
          <vtk-cine-scrub-manipulator
            :view-id="viewId"
            :image-id="currentImageID"
          ></vtk-cine-scrub-manipulator>
          <vtk-cine-scrub-key-manipulator
            :view-id="viewId"
            :image-id="currentImageID"
          ></vtk-cine-scrub-key-manipulator>
          <cine-viewer-overlay
            :view-id="viewId"
            :image-id="currentImageID"
          ></cine-viewer-overlay>
          <vtk-base-slice-representation
            ref="baseSliceRep"
            :view-id="viewId"
            :image-id="currentImageID"
            :axis="VIEW_AXIS"
            :frame="currentFrame"
          ></vtk-base-slice-representation>
          <polygon-tool
            :view-id="viewId"
            :image-id="currentImageID"
            :view-direction="VIEW_DIRECTION"
          />
          <ruler-tool
            :view-id="viewId"
            :image-id="currentImageID"
            :view-direction="VIEW_DIRECTION"
          />
          <rectangle-tool
            :view-id="viewId"
            :image-id="currentImageID"
            :view-direction="VIEW_DIRECTION"
          />
          <select-tool />
          <svg class="overlay-no-events">
            <bounding-rectangle :points="selectionPoints" />
          </svg>
          <slot></slot>
        </vtk-slice-view>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, toRefs, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import VtkSliceView from '@/src/components/vtk/VtkSliceView.vue';
import { VtkViewApi } from '@/src/types/vtk-types';
import { Tools } from '@/src/store/tools/types';
import VtkBaseSliceRepresentation from '@/src/components/vtk/VtkBaseSliceRepresentation.vue';
import { useViewAnimationListener } from '@/src/composables/useViewAnimationListener';
import PolygonTool from '@/src/components/tools/polygon/PolygonTool.vue';
import RulerTool from '@/src/components/tools/ruler/RulerTool.vue';
import RectangleTool from '@/src/components/tools/rectangle/RectangleTool.vue';
import SelectTool from '@/src/components/tools/SelectTool.vue';
import BoundingRectangle from '@/src/components/tools/BoundingRectangle.vue';
import SliceSlider from '@/src/components/SliceSlider.vue';
import CineViewerOverlay from '@/src/components/CineViewerOverlay.vue';
import { useToolSelectionStore } from '@/src/store/tools/toolSelection';
import { useAnnotationToolStore, useToolStore } from '@/src/store/tools';
import { useWebGLWatchdog } from '@/src/composables/useWebGLWatchdog';
import { useCineFrame } from '@/src/composables/useCineFrame';
import VtkCineScrubManipulator from '@/src/components/vtk/VtkCineScrubManipulator.vue';
import VtkCineScrubKeyManipulator from '@/src/components/vtk/VtkCineScrubKeyManipulator.vue';
import VtkMouseInteractionManipulator from '@/src/components/vtk/VtkMouseInteractionManipulator.vue';
import vtkMouseCameraTrackballPanManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballPanManipulator';
import vtkMouseCameraTrackballZoomToMouseManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomToMouseManipulator';
import { useResetViewsEvents } from '@/src/components/tools/ResetViews.vue';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { get2DViewingVectors } from '@/src/utils/getViewingVectors';
import type { LPSAxis } from '@/src/types/lps';

type Props = {
  viewId: string;
};

const VIEW_AXIS: LPSAxis = 'Axial';
const { viewDirection: VIEW_DIRECTION, viewUp: VIEW_UP } =
  get2DViewingVectors(VIEW_AXIS);

const vtkView = ref<VtkViewApi>();
const baseSliceRep = ref();

const props = defineProps<Props>();
const { viewId } = toRefs(props);

const { currentImageID, currentImageData, isImageLoading } = useCurrentImage();

const hover = ref(false);

function resetCamera() {
  vtkView.value?.resetCamera();
}

useResetViewsEvents().onClick(resetCamera);

useWebGLWatchdog(vtkView);
useViewAnimationListener(vtkView, viewId, '2D');

const { currentTool } = storeToRefs(useToolStore());

const { frame: currentFrame, frameRange } = useCineFrame(
  viewId,
  currentImageID
);

onVTKEvent(currentImageData, 'onModified', () => {
  vtkView.value?.requestRender();
});

const selectionStore = useToolSelectionStore();
const selectionPoints = computed(() => {
  return selectionStore.selection
    .map((sel) => {
      const store = useAnnotationToolStore(sel.type);
      return { store, tool: store.toolByID[sel.id] };
    })
    .filter(
      ({ tool }) =>
        tool.imageID === currentImageID.value &&
        tool.frame === currentFrame.value &&
        !tool.hidden
    )
    .flatMap(({ store, tool }) => store.getPoints(tool.id));
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
<style scoped src="@/src/components/styles/utils.css"></style>
