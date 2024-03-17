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
          <div class="overlay-no-events tool-layer">
            <svg class="overlay-no-events"></svg>
          </div>
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
          <slot></slot>
        </vtk-slice-view>
      </div>
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

useViewAnimationListener(vtkView, viewId, viewType);

// base image
const { currentImageID, currentLayers } = useCurrentImage();

// segmentations
const segmentations = computed(() => {
  if (!currentImageID.value) return [];
  const store = useSegmentGroupStore();
  return store.orderByParent[currentImageID.value];
});

// TODO selection points to bounding box
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
<style scoped src="@/src/components/styles/utils.css"></style>
