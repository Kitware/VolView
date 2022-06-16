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
import { getLPSAxisFromDir, LPSAxisDir } from '@/src/utils/lps';
import { Tools, useToolStore } from '@/src/store/tools';
import { useCrosshairsToolStore } from '@/src/store/tools/crosshairs';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
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
    const { position } = storeToRefs(useCrosshairsToolStore());

    const { currentImageMetadata } = useCurrentImage();
    const active = computed(() => toolStore.currentTool === Tools.Crosshairs);
    const isVisible = computed(() => {
      const axis = getLPSAxisFromDir(viewDirection.value);
      const index = currentImageMetadata.value.lpsOrientation[axis];
      return Math.round(position.value[index]) === slice.value;
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
