<template>
  <div class="overlay-no-events">
    <svg class="overlay-no-events">
      <bounding-rectangle :points="visiblePoints" :view-id="viewId" />
      <ruler-widget-2D
        v-for="ruler in rulers"
        :key="ruler.id"
        :tool-id="ruler.id"
        :is-placing="ruler.id === placingRulerID"
        :current-slice="currentSlice"
        :view-id="viewId"
        :view-direction="viewDirection"
        :widget-manager="widgetManager"
        @contextmenu="openContextMenu(ruler.id, $event)"
        @placed="onRulerPlaced"
        @select="onSelect(ruler.id, $event)"
        @widgetHover="onHover(ruler.id, $event)"
      />
    </svg>
    <annotation-info :info="overlayInfo" :tool-store="rulerStore" />
    <annotation-context-menu ref="contextMenu" :tool-store="rulerStore" />
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
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useToolStore } from '@/src/store/tools';
import {
  Tools,
  AnnotationToolType,
  ToolSelectEvent,
} from '@/src/store/tools/types';
import { useRulerStore } from '@/src/store/tools/rulers';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import RulerWidget2D from '@/src/components/tools/ruler/RulerWidget2D.vue';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { LPSAxisDir } from '@/src/types/lps';
import { storeToRefs } from 'pinia';
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
import {
  useToolSelectionStore,
  updateToolSelectionFromEvent,
} from '@/src/store/tools/toolSelection';
import { ToolID } from '@/src/types/annotation-tool';

export default defineComponent({
  name: 'RulerTool',
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
    RulerWidget2D,
    AnnotationContextMenu,
    AnnotationInfo,
    BoundingRectangle,
  },
  setup(props) {
    const { viewDirection, currentSlice } = toRefs(props);
    const toolStore = useToolStore();
    const rulerStore = useRulerStore();
    const { activeLabel } = storeToRefs(rulerStore);

    const { currentImageID, currentImageMetadata } = useCurrentImage();
    const isToolActive = computed(() => toolStore.currentTool === Tools.Ruler);
    const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));

    // --- active ruler management --- //

    const frameOfReference = useFrameOfReference(
      viewDirection,
      currentSlice,
      currentImageMetadata
    );

    const placingTool = usePlacingAnnotationTool(
      rulerStore,
      computed(() => {
        if (!currentImageID.value) return {};
        return {
          imageID: currentImageID.value,
          frameOfReference: frameOfReference.value,
          slice: currentSlice.value,
          label: activeLabel.value,
          ...(activeLabel.value && rulerStore.labels[activeLabel.value]),
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

    const onRulerPlaced = () => {
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

    // --- //

    const { contextMenu, openContextMenu } = useContextMenu();

    // --- ruler data --- //

    const currentTools = useCurrentTools(rulerStore, viewAxis);

    const currentRulers = computed(() => {
      const { lengthByID } = rulerStore;
      return currentTools.value.map((ruler) => ({
        ...ruler,
        length: lengthByID[ruler.id],
      }));
    });

    const { onHover, overlayInfo } = useHover(currentTools, currentSlice);

    const visiblePoints = computed(() => {
      return currentTools.value
        .filter((tool) => tool.slice === currentSlice.value)
        .filter((tool) => selectionStore.isSelected(tool.id))
        .flatMap((tool) => [tool.firstPoint, tool.secondPoint]);
    });

    return {
      rulers: currentRulers,
      placingRulerID: placingTool.id,
      onRulerPlaced,
      contextMenu,
      openContextMenu,
      rulerStore,
      onHover,
      onSelect,
      overlayInfo,
      visiblePoints,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
