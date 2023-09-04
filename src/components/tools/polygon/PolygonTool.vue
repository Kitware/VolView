<template>
  <div class="overlay-no-events">
    <svg class="overlay-no-events">
      <polygon-widget-2D
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
    <AnnotationContextMenu ref="contextMenu" :tool-store="activeToolStore" />
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
import { vec3 } from 'gl-matrix';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import type { Vector3 } from '@kitware/vtk.js/types';
import { LPSAxisDir } from '@/src/types/lps';
import { FrameOfReference } from '@/src/utils/frameOfReference';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { PolygonID } from '@/src/types/polygon';
import {
  useContextMenu,
  useCurrentTools,
} from '@/src/composables/annotationTool';
import AnnotationContextMenu from '@/src/components/tools/AnnotationContextMenu.vue';
import PolygonWidget2D from './PolygonWidget2D.vue';

type ToolID = PolygonID;
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
    AnnotationContextMenu,
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
    // update active tool's frame + slice, since the
    // active tool is not finalized.
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

    const { contextMenu, openContextMenu } = useContextMenu();

    const currentTools = useCurrentTools(activeToolStore, viewAxis);

    return {
      tools: currentTools,
      placingToolID,
      onToolPlaced,
      contextMenu,
      openContextMenu,
      activeToolStore,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
