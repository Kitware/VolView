<template>
  <div class="overlay-no-events">
    <svg class="overlay-no-events">
      <RectangleSVG2D
        v-for="tool in tools"
        :key="tool.id"
        v-show="currentSlice === tool.slice"
        :view-id="viewId"
        :point1="tool.firstPoint"
        :point2="tool.secondPoint"
        :color="tool.color"
      />
      <RectangleSVG2D
        v-if="placingTool"
        :key="placingTool.id"
        :view-id="viewId"
        :point1="placingTool.firstPoint"
        :point2="placingTool.secondPoint"
        :color="placingTool.color"
      />
    </svg>
    <RectangleWidget2D
      v-for="tool in tools"
      :key="tool.id"
      :tool-id="tool.id"
      :current-slice="currentSlice"
      :view-id="viewId"
      :view-direction="viewDirection"
      :widget-manager="widgetManager"
      @contextmenu="openContextMenu(tool.id, $event)"
    />
    <RectangleWidget2D
      v-if="placingTool"
      :key="placingTool.id"
      :tool-id="placingTool.id"
      :current-slice="currentSlice"
      :view-id="viewId"
      :view-direction="viewDirection"
      :widget-manager="widgetManager"
    />
    <v-menu
      v-model="contextMenu.show"
      :position-x="contextMenu.x"
      :position-y="contextMenu.y"
      absolute
      offset-y
      close-on-click
      close-on-content-click
    >
      <v-list dense>
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
  PropType,
  reactive,
  ref,
  toRefs,
  watch,
} from '@vue/composition-api';
import { storeToRefs } from 'pinia';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import RectangleWidget2D from '@/src/components/tools/rectangle/RectangleWidget2D.vue';
import RectangleSVG2D from '@/src/components/tools/rectangle/RectangleSVG2D.vue';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { Vector2 } from '@kitware/vtk.js/types';
import { LPSAxisDir } from '@/src/types/lps';
import { frameOfReferenceToImageSliceAndAxis } from '@/src/utils/frameOfReference';
import { useRectangleStore, ToolID, Tool } from '@/src/store/tools/rectangles';

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
    RectangleSVG2D,
  },
  setup(props) {
    const { viewDirection } = toRefs(props);
    const toolStore = useToolStore();
    const rectangleStore = useRectangleStore();
    const { placingToolByID, tools } = storeToRefs(rectangleStore);

    const placingToolID = ref<ToolID | null>(null);
    const placingTool = computed(
      () => placingToolID.value && placingToolByID.value[placingToolID.value]
    );

    const { currentImageID, currentImageMetadata } = useCurrentImage();
    const isToolActive = computed(
      () => toolStore.currentTool === Tools.Rectangle
    );
    const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));

    watch(
      isToolActive,
      (active) => {
        if (active) {
          placingToolID.value = rectangleStore.createPlacingTool();
        } else if (placingToolID.value != null) {
          rectangleStore.removeTool(placingToolID.value);
        }
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
      rectangleStore.removeTool(contextMenu.forToolID);
    };

    // --- ruler data --- //

    // does the ruler's frame of reference match
    // the view's axis
    const doesToolFrameMatchViewAxis = (ruler: Partial<Tool>) => {
      if (!ruler.frameOfReference) return false;
      const rulerAxis = frameOfReferenceToImageSliceAndAxis(
        ruler.frameOfReference,
        currentImageMetadata.value,
        {
          allowOutOfBoundsSlice: true,
        }
      );
      return !!rulerAxis && rulerAxis.axis === viewAxis.value;
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
      placingTool,
      contextMenu,
      openContextMenu,
      deleteToolFromContextMenu,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
