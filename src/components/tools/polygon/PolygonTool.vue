<template>
  <div class="overlay-no-events">
    <svg class="overlay-no-events">
      <bounding-rectangle :points="visiblePoints" :view-id="viewId" />
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
        @select="onSelect(tool.id, $event)"
        @widgetHover="onHover(tool.id, $event)"
      />
    </svg>
    <annotation-context-menu ref="contextMenu" :tool-store="activeToolStore" />
    <annotation-info :info="overlayInfo" :tool-store="activeToolStore" />
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  onUnmounted,
  PropType,
  toRefs,
  watch,
} from 'vue';
import { storeToRefs } from 'pinia';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useToolStore } from '@/src/store/tools';
import {
  AnnotationToolType,
  Tools,
  ToolSelectEvent,
} from '@/src/store/tools/types';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { LPSAxisDir } from '@/src/types/lps';
import { usePolygonStore } from '@/src/store/tools/polygons';
import {
  useContextMenu,
  useCurrentTools,
  useHover,
  usePlacingAnnotationTool,
} from '@/src/composables/annotationTool';
import AnnotationContextMenu from '@/src/components/tools/AnnotationContextMenu.vue';
import AnnotationInfo from '@/src/components/tools/AnnotationInfo.vue';
import BoundingRectangle from '@/src/components/tools/BoundingRectangle.vue';
import { useFrameOfReference } from '@/src/composables/useFrameOfReference';
import { ToolID } from '@/src/types/annotation-tool';
import {
  updateToolSelectionFromEvent,
  useToolSelectionStore,
} from '@/src/store/tools/toolSelection';
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

    // --- active tool management --- //

    const frameOfReference = useFrameOfReference(
      viewDirection,
      currentSlice,
      currentImageMetadata
    );

    const placingTool = usePlacingAnnotationTool(
      activeToolStore,
      computed(() => {
        if (!currentImageID.value) return {};
        return {
          imageID: currentImageID.value,
          frameOfReference: frameOfReference.value,
          slice: currentSlice.value,
          label: activeLabel.value,
          ...(activeLabel.value && activeToolStore.labels[activeLabel.value]),
        };
      })
    );

    watch(
      [isToolActive, currentImageID] as const,
      ([active, imageID]) => {
        placingTool.remove();
        if (active && imageID) {
          placingTool.add();
        }
      },
      { immediate: true }
    );

    onUnmounted(() => {
      placingTool.remove();
    });

    const onToolPlaced = () => {
      if (currentImageID.value) {
        placingTool.commit();
        placingTool.add();
      }
    };

    // --- selection handling --- //

    const selectionStore = useToolSelectionStore();

    const onSelect = (id: ToolID, event: ToolSelectEvent) => {
      updateToolSelectionFromEvent(id, event, AnnotationToolType.Ruler);
    };

    // ---  //

    const { contextMenu, openContextMenu } = useContextMenu();

    const currentTools = useCurrentTools(activeToolStore, viewAxis);

    const { onHover, overlayInfo } = useHover(currentTools, currentSlice);

    const visiblePoints = computed(() => {
      return currentTools.value
        .filter((tool) => tool.slice === currentSlice.value)
        .filter((tool) => selectionStore.isSelected(tool.id))
        .flatMap((tool) => tool.points);
    });

    return {
      tools: currentTools,
      placingToolID: placingTool.id,
      onToolPlaced,
      contextMenu,
      openContextMenu,
      activeToolStore,
      onHover,
      onSelect,
      overlayInfo,
      visiblePoints,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
