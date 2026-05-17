<script setup lang="ts">
import { toRefs, computed } from 'vue';
import ViewOverlayGrid from '@/src/components/ViewOverlayGrid.vue';
import { Maybe } from '@/src/types';
import { useCineFrame } from '@/src/composables/useCineFrame';
import DicomQuickInfoButton from '@/src/components/DicomQuickInfoButton.vue';
import { useImage } from '@/src/composables/useCurrentImage';
import PlayControls from '@/src/components/PlayControls.vue';

type Props = {
  viewId: string;
  imageId: Maybe<string>;
};

const props = defineProps<Props>();
const { viewId, imageId } = toRefs(props);

const { metadata } = useImage(imageId);
const { frame, frameRange } = useCineFrame(viewId, imageId);
const frameCount = computed(() => frameRange.value[1] + 1);
</script>

<template>
  <view-overlay-grid class="overlay-no-events view-annotations">
    <template v-slot:top-left>
      <div class="annotation-cell">
        <span>{{ metadata.name }}</span>
      </div>
    </template>
    <template v-slot:bottom-left>
      <div class="annotation-cell">
        <div>
          <span class="frame-label">
            Frame: {{ frame + 1 }} / {{ frameCount }}
          </span>
        </div>
      </div>
    </template>
    <template v-slot:top-right>
      <div class="annotation-cell">
        <dicom-quick-info-button :image-id="imageId"></dicom-quick-info-button>
      </div>
    </template>
    <template #bottom-right>
      <div class="annotation-cell" @click.stop>
        <play-controls :view-id="viewId" :image-id="imageId" />
      </div>
    </template>
  </view-overlay-grid>
</template>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
