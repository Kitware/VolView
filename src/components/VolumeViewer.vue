<template>
  <div class="vtk-container-wrapper volume-viewer-container" tabindex="0">
    <div class="vtk-container" data-testid="two-view-container">
      <v-progress-linear
        v-if="isImageLoading"
        indeterminate
        class="loading-indicator"
        height="2"
        color="grey"
      />
      <div class="vtk-sub-container">
        <vtk-volume-view
          class="vtk-view"
          ref="vtkView"
          data-testid="vtk-view vtk-two-view"
          :view-id="viewId"
          :image-id="currentImageID"
          :view-direction="viewDirection"
          :view-up="viewUp"
        >
          <vtk-base-volume-representation
            :view-id="viewId"
            :image-id="currentImageID"
          ></vtk-base-volume-representation>
          <vtk-orientation-marker></vtk-orientation-marker>
          <crop-tool :view-id="viewId" :image-id="currentImageID"></crop-tool>
          <slot></slot>
        </vtk-volume-view>
      </div>
      <view-overlay-grid class="overlay-no-events view-annotations">
        <template v-slot:top-left>
          <div class="annotation-cell">
            <v-btn
              class="pointer-events-all"
              dark
              icon
              size="medium"
              variant="text"
              @click="resetCamera"
            >
              <v-icon size="medium" class="py-1">
                mdi-camera-flip-outline
              </v-icon>
              <v-tooltip
                location="right"
                activator="parent"
                transition="slide-x-transition"
              >
                Reset Camera
              </v-tooltip>
            </v-btn>
            <span class="ml-3">{{ presetName }}</span>
          </div>
        </template>
        <template #bottom-right>
          <div class="annotation-cell" @click.stop>
            <ViewTypeSwitcher :view-id="viewId" :image-id="currentImageID" />
          </div>
        </template>
      </view-overlay-grid>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, toRefs, computed } from 'vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { LPSAxisDir } from '@/src/types/lps';
import VtkVolumeView from '@/src/components/vtk/VtkVolumeView.vue';
import { VtkViewApi } from '@/src/types/vtk-types';
import VtkBaseVolumeRepresentation from '@/src/components/vtk/VtkBaseVolumeRepresentation.vue';
import { useViewAnimationListener } from '@/src/composables/useViewAnimationListener';
import CropTool from '@/src/components/tools/crop/CropTool.vue';
import { useWebGLWatchdog } from '@/src/composables/useWebGLWatchdog';
import VtkOrientationMarker from '@/src/components/vtk/VtkOrientationMarker.vue';
import ViewOverlayGrid from '@/src/components/ViewOverlayGrid.vue';
import useVolumeColoringStore from '@/src/store/view-configs/volume-coloring';
import { useResetViewsEvents } from '@/src/components/tools/ResetViews.vue';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { useViewStore } from '@/src/store/views';
import ViewTypeSwitcher from '@/src/components/ViewTypeSwitcher.vue';

interface Props {
  viewId: string;
}

interface VolumeViewerOptions {
  viewDirection: LPSAxisDir;
  viewUp: LPSAxisDir;
}

const vtkView = ref<VtkViewApi>();

const props = defineProps<Props>();

const { viewId } = toRefs(props);

const viewStore = useViewStore();
const viewInfo = computed(() => viewStore.getView(viewId.value)!);
const viewType = computed(() => viewInfo.value.type);
const viewOptions = computed(
  () => viewInfo.value.options as VolumeViewerOptions
);
const viewDirection = computed(() => viewOptions.value.viewDirection);
const viewUp = computed(() => viewOptions.value.viewUp);

function resetCamera() {
  if (!vtkView.value) return;
  vtkView.value.resetCamera();
  vtkView.value.renderer.updateLightsGeometryToFollowCamera();
}

useResetViewsEvents().onClick(resetCamera);

useWebGLWatchdog(vtkView);
useViewAnimationListener(vtkView, viewId, viewType);

// base image
const { currentImageID, currentImageData, isImageLoading } = useCurrentImage();

onVTKEvent(currentImageData, 'onModified', () => {
  vtkView.value?.requestRender();
});

// color preset
const coloringStore = useVolumeColoringStore();
const coloringConfig = computed(() =>
  coloringStore.getConfig(viewId.value, currentImageID.value)
);
const presetName = computed(
  () => coloringConfig.value?.transferFunction.preset.replace(/-/g, ' ') ?? ''
);
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
<style scoped src="@/src/components/styles/utils.css"></style>

<style scoped>
.volume-viewer-container {
  background-color: black;
  grid-template-columns: auto;
}
</style>
