<template>
  <div class="overlay-no-events">
    <svg class="overlay-no-events">
      <RectangleWidget2D
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
      />
    </svg>
    <v-menu
      v-model="contextMenu.show"
      class="position-absolute"
      :style="{
        top: `${contextMenu.y}px`,
        left: `${contextMenu.x}px`,
      }"
      close-on-click
      close-on-content-click
    >
      <v-list density="compact">
        <v-list-item @click="deleteToolFromContextMenu">
          <v-list-item-title>Delete</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-menu>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  onUnmounted,
  PropType,
  reactive,
  ref,
  toRefs,
  watch,
} from 'vue';
import { storeToRefs } from 'pinia';
import { vec3 } from 'gl-matrix';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import type { Vector2, Vector3 } from '@kitware/vtk.js/types';
import { LPSAxisDir } from '@/src/types/lps';
import {
  FrameOfReference,
  frameOfReferenceToImageSliceAndAxis,
} from '@/src/utils/frameOfReference';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { Rectangle, RectangleID } from '@/src/types/rectangle';
import RectangleWidget2D from './RectangleWidget2D.vue';

type ToolID = RectangleID;
type Tool = Rectangle;
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
  },
  setup(props) {
    const { viewDirection, currentSlice } = toRefs(props);
    const toolStore = useToolStore();
    const activeToolStore = useActiveToolStore();
    const { tools, activeLabel } = storeToRefs(activeToolStore);

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

    // TODO useCurrentFrameOfReference(viewDirection)
    const getCurrentFrameOfReference = (): FrameOfReference => {
      const { lpsOrientation, indexToWorld } = currentImageMetadata.value;
      const planeNormal = lpsOrientation[viewDirection.value] as Vector3;
      const lpsIdx = lpsOrientation[viewAxis.value];
      const planeOrigin: Vector3 = [0, 0, 0];
      planeOrigin[lpsIdx] = currentSlice.value;
      // convert index pt to world pt
      vec3.transformMat4(planeOrigin, planeOrigin, indexToWorld);
      return {
        planeNormal,
        planeOrigin,
      };
    };
    // update active ruler's frame + slice, since the
    // active ruler is not finalized.
    watch(
      [currentSlice, placingToolID] as const,
      ([slice, toolID]) => {
        if (!toolID) return;
        activeToolStore.updateTool(toolID, {
          frameOfReference: getCurrentFrameOfReference(),
          slice,
        });
      },
      { immediate: true }
    );

    // --- context menu --- //

    const contextMenu = reactive({
      show: false,
      x: 0,
      y: 0,
      forToolID: '' as ToolID,
    });

    const openContextMenu = (toolID: ToolID, displayXY: Vector2) => {
      [contextMenu.x, contextMenu.y] = displayXY;
      contextMenu.show = true;
      contextMenu.forToolID = toolID;
    };

    const deleteToolFromContextMenu = () => {
      activeToolStore.removeTool(contextMenu.forToolID);
    };

    // --- tool data --- //

    // does the tools's frame of reference match
    // the view's axis
    const doesToolFrameMatchViewAxis = (tool: Partial<Tool>) => {
      if (!tool.frameOfReference) return false;
      const toolAxis = frameOfReferenceToImageSliceAndAxis(
        tool.frameOfReference,
        currentImageMetadata.value,
        {
          allowOutOfBoundsSlice: true,
        }
      );
      return !!toolAxis && toolAxis.axis === viewAxis.value;
    };

    const currentTools = computed(() => {
      const curImageID = currentImageID.value;

      return tools.value.filter((tool) => {
        // only show tools for the current image
        // and current view axis
        return tool.imageID === curImageID && doesToolFrameMatchViewAxis(tool);
      });
    });

    return {
      tools: currentTools,
      placingToolID,
      contextMenu,
      openContextMenu,
      deleteToolFromContextMenu,
      onToolPlaced,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
