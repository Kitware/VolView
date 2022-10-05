<template>
  <div v-if="active" class="overlay-no-events">
    <svg class="overlay-no-events">
      <CrosshairSVG2D
        v-show="isVisible"
        :view-id="viewId"
        :position="position"
      />
    </svg>
    <CrosshairsWidget2D
      :slice="slice"
      :view-id="viewId"
      :view-direction="viewDirection"
      :widget-manager="widgetManager"
    />
  </div>
</template>

<script lang="ts">
import { storeToRefs } from 'pinia';
import {
  computed,
  defineComponent,
  PropType,
  toRefs,
} from '@vue/composition-api';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import { LPSAxisDir } from '@/src/types/lps';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import { useCrosshairsToolStore } from '@/src/store/tools/crosshairs';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { clampValue } from '@/src/utils';
import CrosshairsWidget2D from './crosshairs/CrosshairsWidget2D.vue';
import CrosshairSVG2D from './crosshairs/CrosshairSVG2D.vue';

export default defineComponent({
  name: 'CrosshairsTool',
  props: {
    viewId: {
      type: String,
      required: true,
    },
    slice: {
      type: Number,
      required: true,
    },
    viewDirection: {
      type: String as PropType<LPSAxisDir>,
      required: true,
    },
    widgetManager: {
      type: Object as PropType<vtkWidgetManager>,
      required: true,
    },
  },
  components: {
    CrosshairsWidget2D,
    CrosshairSVG2D,
  },
  setup(props) {
    const { viewDirection, slice } = toRefs(props);

    const toolStore = useToolStore();
    const { position, imagePosition } = storeToRefs(useCrosshairsToolStore());

    const { currentImageMetadata } = useCurrentImage();
    const active = computed(() => toolStore.currentTool === Tools.Crosshairs);
    const isVisible = computed(() => {
      const { lpsOrientation, dimensions } = currentImageMetadata.value;
      const axis = getLPSAxisFromDir(viewDirection.value);
      const index = lpsOrientation[axis];
      // Since the image rectangle is inflated by 0.5,
      // clamp to the allowed range for the slice.
      const crosshairsSlice = clampValue(
        imagePosition.value[index],
        0,
        dimensions[index] - 1
      );
      return Math.round(crosshairsSlice) === slice.value;
    });

    return {
      active,
      position,
      isVisible,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
