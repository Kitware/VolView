<template>
  <div class="overlay-no-events">
    <svg class="overlay-no-events">
      <rectangle-widget-2D
        v-for="tool in tools"
        :key="tool.id"
        :tool-id="tool.id"
        :current-slice="currentSlice"
        :view-id="viewId"
        :view-direction="viewDirection"
        :widget-manager="widgetManager"
        @contextmenu="openContextMenu(tool.id, $event)"
      />
      <placing-rectangle-widget-2D
        v-if="isToolActive"
        :current-slice="currentSlice"
        :color="activeLabelProps.color"
        :fill-color="activeLabelProps.fillColor"
        :view-id="viewId"
        :view-direction="viewDirection"
        :widget-manager="widgetManager"
        @placed="onToolPlaced"
      />
    </svg>
    <annotation-context-menu ref="contextMenu" :tool-store="activeToolStore" />
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, PropType, toRefs } from 'vue';
import { storeToRefs } from 'pinia';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { LPSAxisDir } from '@/src/types/lps';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import {
  useCurrentTools,
  useContextMenu,
} from '@/src/composables/annotationTool';
import AnnotationContextMenu from '@/src/components/tools/AnnotationContextMenu.vue';
import PlacingRectangleWidget2D from '@/src/components/tools/rectangle/PlacingRectangleWidget2D.vue';
import { useCurrentFrameOfReference } from '@/src/composables/useCurrentFrameOfReference';
import { RectangleInitState } from '@/src/components/tools/rectangle/common';
import RectangleWidget2D from './RectangleWidget2D.vue';

const useActiveToolStore = useRectangleStore;
const toolType = Tools.Rectangle;

export default defineComponent({
  name: 'RectangleTool',
  props: {
    viewId: {
      type: String,
      required: true,
    },
    currentSlice: {
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
    RectangleWidget2D,
    PlacingRectangleWidget2D,
    AnnotationContextMenu,
  },
  setup(props) {
    const { viewDirection, currentSlice } = toRefs(props);
    const toolStore = useToolStore();
    const activeToolStore = useActiveToolStore();
    const { activeLabel } = storeToRefs(activeToolStore);

    const { currentImageID } = useCurrentImage();
    const isToolActive = computed(() => toolStore.currentTool === toolType);
    const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));

    const currentFrameOfReference = useCurrentFrameOfReference(
      viewDirection,
      currentSlice
    );

    const onToolPlaced = (initState: RectangleInitState) => {
      if (!currentImageID.value) return;
      activeToolStore.addTool({
        imageID: currentImageID.value,
        frameOfReference: currentFrameOfReference.value,
        slice: currentSlice.value,
        label: activeLabel.value,
        color: activeLabel.value
          ? activeToolStore.labels[activeLabel.value].color
          : undefined,
        firstPoint: initState.firstPoint,
        secondPoint: initState.secondPoint,
      });
    };

    // --- right-click menu --- //

    const { contextMenu, openContextMenu } = useContextMenu();

    // --- //

    const currentTools = useCurrentTools(activeToolStore, viewAxis);
    const activeLabelProps = computed(() => {
      return activeLabel.value ? activeToolStore.labels[activeLabel.value] : {};
    });

    return {
      tools: currentTools,
      isToolActive,
      onToolPlaced,
      contextMenu,
      openContextMenu,
      activeToolStore,
      activeLabelProps,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
