<template>
  <div class="overlay-no-events">
    <svg class="overlay-no-events">
      <bounding-rectangle :points="points" :view-id="viewId" />
      <rectangle-widget-2D
        v-for="tool in tools"
        :key="tool.id"
        :tool-id="tool.id"
        :is-placing="tool.id === placingToolID"
        :current-slice="currentSlice"
        :view-id="viewId"
        :view-direction="viewDirection"
        :widget-manager="widgetManager"
        @contextmenu="openContextMenu(tool.id, $event)"
        @placed="onToolPlaced"
        @widgetHover="onHover(tool.id, $event)"
      />
    </svg>
    <annotation-info :info="overlayInfo" :tool-store="activeToolStore" />
    <annotation-context-menu ref="contextMenu" :tool-store="activeToolStore" />
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  onUnmounted,
  PropType,
  ref,
  toRefs,
  watch,
} from 'vue';
import { storeToRefs } from 'pinia';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { LPSAxisDir } from '@/src/types/lps';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { RectangleID } from '@/src/types/rectangle';
import {
  useCurrentTools,
  useContextMenu,
  useHover,
} from '@/src/composables/annotationTool';
import AnnotationContextMenu from '@/src/components/tools/AnnotationContextMenu.vue';
import AnnotationInfo from '@/src/components/tools/AnnotationInfo.vue';
import BoundingRectangle from '@/src/components/tools/BoundingRectangle.vue';
import { useFrameOfReference } from '@/src/composables/useFrameOfReference';
import RectangleWidget2D from './RectangleWidget2D.vue';

type ToolID = RectangleID;
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
    AnnotationContextMenu,
    AnnotationInfo,
    BoundingRectangle,
  },
  setup(props) {
    const { viewDirection, currentSlice } = toRefs(props);
    const toolStore = useToolStore();
    const activeToolStore = useActiveToolStore();
    const { activeLabel } = storeToRefs(activeToolStore);

    const { currentImageID, currentImageMetadata } = useCurrentImage();
    const isToolActive = computed(() => toolStore.currentTool === toolType);
    const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));

    const placingToolID = ref<ToolID | null>(null);

    // --- active tool management --- //

    watch(
      placingToolID,
      (id, prevId) => {
        if (prevId != null) {
          activeToolStore.updateTool(prevId, { placing: false });
        }
        if (id != null) {
          activeToolStore.updateTool(id, { placing: true });
        }
      },
      { immediate: true }
    );

    watch(
      [isToolActive, currentImageID] as const,
      ([active, imageID]) => {
        if (placingToolID.value != null) {
          activeToolStore.removeTool(placingToolID.value);
          placingToolID.value = null;
        }
        if (active && imageID) {
          placingToolID.value = activeToolStore.addTool({
            imageID,
            placing: true,
          });
        }
      },
      { immediate: true }
    );

    watch(
      [activeLabel, placingToolID],
      ([label, placingTool]) => {
        if (placingTool != null) {
          activeToolStore.updateTool(placingTool, {
            label,
            ...(label && activeToolStore.labels[label]),
          });
        }
      },
      { immediate: true }
    );

    onUnmounted(() => {
      if (placingToolID.value != null) {
        activeToolStore.removeTool(placingToolID.value);
        placingToolID.value = null;
      }
    });

    const onToolPlaced = () => {
      if (currentImageID.value) {
        placingToolID.value = activeToolStore.addTool({
          imageID: currentImageID.value,
          placing: true,
        });
      }
    };

    // --- updating active tool frame --- //

    const frameOfReference = useFrameOfReference(
      viewDirection,
      currentSlice,
      currentImageMetadata
    );

    // update active ruler's frame + slice, since the
    // active ruler is not finalized.
    watch(
      [currentSlice, placingToolID] as const,
      ([slice, toolID]) => {
        if (!toolID) return;
        activeToolStore.updateTool(toolID, {
          frameOfReference: frameOfReference.value,
          slice,
        });
      },
      { immediate: true }
    );

    const { contextMenu, openContextMenu } = useContextMenu();

    const currentTools = useCurrentTools(activeToolStore, viewAxis);

    const { onHover, overlayInfo } = useHover(currentTools, currentSlice);

    const points = computed(() => {
      if (!overlayInfo.value.visible) return [];
      const tool = activeToolStore.toolByID[overlayInfo.value.toolID];
      return [tool.firstPoint, tool.secondPoint];
    });

    return {
      tools: currentTools,
      placingToolID,
      onToolPlaced,
      contextMenu,
      openContextMenu,
      activeToolStore,
      onHover,
      overlayInfo,
      points,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
