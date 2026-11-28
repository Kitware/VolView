<script setup lang="ts">
import { toRefs, computed, useTemplateRef } from 'vue';
import ViewOverlayGrid from '@/src/components/ViewOverlayGrid.vue';
import { Maybe } from '@/src/types';
import { useCineFrame } from '@/src/composables/useCineFrame';
import DicomQuickInfoButton from '@/src/components/DicomQuickInfoButton.vue';
import { useImage } from '@/src/composables/useCurrentImage';
import { useNarrowPane } from '@/src/composables/useNarrowPane';
import ViewLayoutActions from '@/src/components/ViewLayoutActions.vue';
import ViewMoveHandle from '@/src/components/ViewMoveHandle.vue';
import PlayControls from '@/src/components/PlayControls.vue';

// The narrowest pane, in pixels, that fits the labeled play controls, View
// actions and move handle on one row.
const FULL_ROW_PANE_WIDTH = 176;

type Props = {
  viewId: string;
  imageId: Maybe<string>;
};

const props = defineProps<Props>();
const { viewId, imageId } = toRefs(props);

const { metadata } = useImage(imageId);
const { frame, frameRange } = useCineFrame(viewId, imageId);
const frameCount = computed(() => frameRange.value[1] + 1);
const controls = useTemplateRef<HTMLElement>('controls');
const compact = useNarrowPane(controls, FULL_ROW_PANE_WIDTH);
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
      <div
        ref="controls"
        class="annotation-cell d-flex align-center justify-end"
        @click.stop
        @dblclick.stop
      >
        <play-controls
          :view-id="viewId"
          :image-id="imageId"
          :compact="compact"
        />
        <ViewLayoutActions :view-id="viewId" />
        <ViewMoveHandle :view-id="viewId" />
      </div>
    </template>
  </view-overlay-grid>
</template>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
