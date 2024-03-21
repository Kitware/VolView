<template>
  <div
    class="vtk-container-wrapper"
    tabindex="0"
    @pointerenter="hover = true"
    @pointerleave="hover = false"
    @focusin="hover = true"
    @focusout="hover = false"
  >
    <div class="vtk-gutter">
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
        v-model="currentSlice"
        class="slice-slider"
        :min="sliceRange[0]"
        :max="sliceRange[1]"
        :step="1"
        :handle-height="20"
      />
    </div>
    <div class="vtk-container" data-testid="two-view-container">
      <div class="vtk-sub-container">
        <vtk-slice-view
          class="vtk-view"
          ref="vtkView"
          data-testid="vtk-view vtk-two-view"
          :view-id="id"
          :image-id="currentImageID"
          :view-direction="viewDirection"
          :view-up="viewUp"
        >
          <slice-viewer-overlay
            :view-id="id"
            :image-id="currentImageID"
          ></slice-viewer-overlay>
          <vtk-base-slice-representation
            :view-id="id"
            :image-id="currentImageID"
            :axis="viewAxis"
          ></vtk-base-slice-representation>
          <vtk-segmentation-slice-representation
            v-for="segId in segmentations"
            :key="`seg-${segId}`"
            :view-id="id"
            :segmentation-id="segId"
            :axis="viewAxis"
          ></vtk-segmentation-slice-representation>
          <template v-if="currentImageID">
            <vtk-layer-slice-representation
              v-for="layer in currentLayers"
              :key="`layer-${layer.id}`"
              :view-id="id"
              :layer-id="layer.id"
              :parent-id="currentImageID"
              :axis="viewAxis"
            ></vtk-layer-slice-representation>
          </template>
          <crop-tool :view-id="viewId" :image-id="currentImageID" />
          <crosshairs-tool
            :view-id="viewId"
            :image-id="currentImageID"
            :view-direction="viewDirection"
          />
          <paint-tool
            :view-id="viewId"
            :image-id="currentImageID"
            :view-direction="viewDirection"
          />
          <polygon-tool
            :view-id="viewId"
            :image-id="currentImageID"
            :view-direction="viewDirection"
          />
          <ruler-tool
            :view-id="viewId"
            :image-id="currentImageID"
            :view-direction="viewDirection"
          />
          <rectangle-tool
            :view-id="viewId"
            :image-id="currentImageID"
            :view-direction="viewDirection"
          />
          <select-tool />
          <svg class="overlay-no-events">
            <bounding-rectangle :points="selectionPoints" />
          </svg>
          <slot></slot>
        </vtk-slice-view>
      </div>
      <transition name="loading">
        <div v-if="isImageLoading" class="overlay-no-events loading">
          <div>Loading the image</div>
          <div>
            <v-progress-circular indeterminate color="blue" />
          </div>
        </div>
      </transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, toRefs, computed } from 'vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { LPSAxisDir } from '@/src/types/lps';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import VtkSliceView from '@/src/components/vtk/VtkSliceView.vue';
import { VtkViewApi } from '@/src/types/vtk-types';
import { LayoutViewProps } from '@/src/types';
import VtkBaseSliceRepresentation from '@/src/components/vtk/VtkBaseSliceRepresentation.vue';
import VtkSegmentationSliceRepresentation from '@/src/components/vtk/VtkSegmentationSliceRepresentation.vue';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import VtkLayerSliceRepresentation from '@/src/components/vtk/VtkLayerSliceRepresentation.vue';
import { useViewAnimationListener } from '@/src/composables/useViewAnimationListener';
import CropTool from '@/src/components/tools/crop/CropTool.vue';
import CrosshairsTool from '@/src/components/tools/crosshairs/CrosshairsTool.vue';
import PaintTool from '@/src/components/tools/paint/PaintTool.vue';
import PolygonTool from '@/src/components/tools/polygon/PolygonTool.vue';
import RulerTool from '@/src/components/tools/ruler/RulerTool.vue';
import RectangleTool from '@/src/components/tools/rectangle/RectangleTool.vue';
import SelectTool from '@/src/components/tools/SelectTool.vue';
import BoundingRectangle from '@/src/components/tools/BoundingRectangle.vue';
import SliceSlider from '@/src/components/SliceSlider.vue';
import SliceViewerOverlay from '@/src/components/SliceViewerOverlay.vue';
import { useToolSelectionStore } from '@/src/store/tools/toolSelection';
import { useAnnotationToolStore } from '@/src/store/tools';
import { doesToolFrameMatchViewAxis } from '@/src/composables/annotationTool';
import { useWebGLWatchdog } from '@/src/composables/useWebGLWatchdog';
import { useSliceConfig } from '@/src/composables/useSliceConfig';

interface Props extends LayoutViewProps {
  viewDirection: LPSAxisDir;
  viewUp: LPSAxisDir;
}

const vtkView = ref<VtkViewApi>();

const props = defineProps<Props>();

const { id: viewId, type: viewType, viewDirection, viewUp } = toRefs(props);
const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));

const hover = ref(false);

function resetCamera() {
  if (!vtkView.value) return;
  vtkView.value.resetCamera();
}

useWebGLWatchdog(vtkView);
useViewAnimationListener(vtkView, viewId, viewType);

// base image
const { currentImageID, currentLayers, currentImageMetadata, isImageLoading } =
  useCurrentImage();
const { slice: currentSlice, range: sliceRange } = useSliceConfig(
  viewId,
  currentImageID
);

// segmentations
const segmentations = computed(() => {
  if (!currentImageID.value) return [];
  const store = useSegmentGroupStore();
  return store.orderByParent[currentImageID.value];
});

// --- selection points --- //

const selectionStore = useToolSelectionStore();
const selectionPoints = computed(() => {
  return selectionStore.selection
    .map((sel) => {
      const store = useAnnotationToolStore(sel.type);
      return { store, tool: store.toolByID[sel.id] };
    })
    .filter(
      ({ tool }) =>
        tool.slice === currentSlice.value &&
        doesToolFrameMatchViewAxis(viewAxis, tool, currentImageMetadata)
    )
    .flatMap(({ store, tool }) => store.getPoints(tool.id));
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
<style scoped src="@/src/components/styles/utils.css"></style>
