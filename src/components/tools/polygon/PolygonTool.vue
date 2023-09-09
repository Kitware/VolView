<template>
  <div class="overlay-no-events">
    <svg class="overlay-no-events">
      <polygon-widget-2D
        v-for="tool in tools"
        :key="tool.id"
        :tool-id="tool.id"
        :current-slice="currentSlice"
        :view-id="viewId"
        :view-direction="viewDirection"
        :widget-manager="widgetManager"
        @contextmenu="openContextMenu(tool.id, $event)"
      />
      <placing-polygon-widget-2D
        v-if="isToolActive"
        :current-slice="currentSlice"
        :color="activeLabelColor"
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
import { usePolygonStore } from '@/src/store/tools/polygons';
import {
  useContextMenu,
  useCurrentTools,
} from '@/src/composables/annotationTool';
import { useCurrentFrameOfReference } from '@/src/composables/useCurrentFrameOfReference';
import AnnotationContextMenu from '@/src/components/tools/AnnotationContextMenu.vue';
import PlacingPolygonWidget2D from '@/src/components/tools/polygon/PlacingPolygonWidget2D.vue';
import { PolygonInitState } from '@/src/components/tools/polygon/common';
import PolygonWidget2D from './PolygonWidget2D.vue';

const useActiveToolStore = usePolygonStore;
const toolType = Tools.Polygon;

export default defineComponent({
  name: 'PolygonTool',
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
    PolygonWidget2D,
    PlacingPolygonWidget2D,
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

    const onToolPlaced = (initState: PolygonInitState) => {
      if (!currentImageID.value) return;
      activeToolStore.addTool({
        imageID: currentImageID.value,
        frameOfReference: currentFrameOfReference.value,
        slice: currentSlice.value,
        label: activeLabel.value,
        color: activeLabel.value
          ? activeToolStore.labels[activeLabel.value].color
          : undefined,
        points: initState.points,
      });
    };

    // --- right-click menu --- //

    const { contextMenu, openContextMenu } = useContextMenu();

    const currentTools = useCurrentTools(activeToolStore, viewAxis);

    return {
      tools: currentTools,
      isToolActive,
      activeLabelColor: computed(() => {
        return (
          activeLabel.value && activeToolStore.labels[activeLabel.value].color
        );
      }),
      onToolPlaced,
      contextMenu,
      openContextMenu,
      activeToolStore,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
