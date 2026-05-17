<script setup lang="ts">
import { inject, toRefs } from 'vue';
import ViewOverlayGrid from '@/src/components/ViewOverlayGrid.vue';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import { Maybe } from '@/src/types';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useWindowingConfig } from '@/src/composables/useWindowingConfig';
import { useOrientationLabels } from '@/src/composables/useOrientationLabels';
import DicomQuickInfoButton from '@/src/components/DicomQuickInfoButton.vue';
import ViewTypeSwitcher from '@/src/components/ViewTypeSwitcher.vue';
import { useImage } from '@/src/composables/useCurrentImage';
import { isCineImage } from '@/src/core/cine/isCineImage';
import PlayControls from '@/src/components/PlayControls.vue';
import { computed } from 'vue';

interface Props {
  viewId: string;
  imageId: Maybe<string>;
}

const props = defineProps<Props>();
const { viewId, imageId } = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const { top: topLabel, left: leftLabel } = useOrientationLabels(view);

const {
  config: sliceConfig,
  slice,
  range: sliceRange,
} = useSliceConfig(viewId, imageId);
const {
  config: wlConfig,
  width: windowWidth,
  level: windowLevel,
} = useWindowingConfig(viewId, imageId);
const { metadata } = useImage(imageId);

const isCine = computed(() => isCineImage(imageId.value));
</script>

<template>
  <view-overlay-grid class="overlay-no-events view-annotations">
    <template v-slot:top-left>
      <div class="annotation-cell">
        <span>{{ metadata.name }}</span>
      </div>
    </template>
    <template v-slot:top-center>
      <div class="annotation-cell">
        <span>{{ topLabel }}</span>
      </div>
    </template>
    <template v-slot:middle-left>
      <div class="annotation-cell">
        <span>{{ leftLabel }}</span>
      </div>
    </template>
    <template v-slot:bottom-left>
      <div class="annotation-cell">
        <div v-if="sliceConfig">
          <span v-if="isCine" class="frame-label">
            Frame: {{ slice + 1 }} / {{ sliceRange[1] + 1 }}
          </span>
          <span v-else class="slice-label">
            Slice: {{ slice + 1 }}/{{ sliceRange[1] + 1 }}
          </span>
        </div>
        <div v-if="wlConfig && !isCine">
          W/L: {{ windowWidth.toFixed(2) }} / {{ windowLevel.toFixed(2) }}
        </div>
      </div>
    </template>
    <template v-slot:bottom-center>
      <div v-if="isCine" class="annotation-cell" @click.stop>
        <play-controls :view-id="viewId" :image-id="imageId" />
      </div>
    </template>
    <template v-slot:top-right>
      <div class="annotation-cell">
        <dicom-quick-info-button :image-id="imageId"></dicom-quick-info-button>
      </div>
    </template>
    <template #bottom-right>
      <div
        v-if="
          !viewId.includes('-coronal') &&
          !viewId.includes('-sagittal') &&
          !viewId.includes('-axial') &&
          !viewId.includes('-multi-oblique')
        "
        class="annotation-cell"
        @click.stop
      >
        <ViewTypeSwitcher :view-id="viewId" :image-id="imageId" />
      </div>
    </template>
  </view-overlay-grid>
</template>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
