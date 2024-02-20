<template>
  <div class="vtk-container-wrapper" tabindex="0">
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
        <vtk-volume-view
          class="vtk-view"
          ref="vtkView"
          data-testid="vtk-view vtk-two-view"
          :view-id="id"
          :image-id="currentImageID"
          :view-direction="viewDirection"
          :view-up="viewUp"
        >
          <vtk-base-volume-representation
            :view-id="id"
            :view-type="type"
            :image-id="currentImageID"
          ></vtk-base-volume-representation>
          <slot></slot>
        </vtk-volume-view>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, toRefs } from 'vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { LPSAxisDir } from '@/src/types/lps';
import VtkVolumeView from '@/src/components/vtk/VtkVolumeView.vue';
import { VtkViewApi } from '@/src/types/vtk-types';
import VtkBaseVolumeRepresentation from '@/src/components/vtk/VtkBaseVolumeRepresentation.vue';

interface Props {
  id: string;
  type: string;
  viewDirection: LPSAxisDir;
  viewUp: LPSAxisDir;
}

const vtkView = ref<VtkViewApi>();

const props = defineProps<Props>();

const { viewDirection, viewUp } = toRefs(props);

function resetCamera() {
  if (!vtkView.value) return;
  vtkView.value.resetCamera();
}

// base image
const { currentImageID } = useCurrentImage();
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
<style scoped src="@/src/components/styles/utils.css"></style>
