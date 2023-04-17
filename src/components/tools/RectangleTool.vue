<template>
  <div class="overlay-no-events">
    <svg class="overlay-no-events">
      <RectangleSVG2D
        v-for="ruler in rulers"
        :key="ruler.id"
        v-show="currentSlice === ruler.slice"
        :view-id="viewId"
        :point1="ruler.firstPoint"
        :point2="ruler.secondPoint"
        :color="ruler.color"
      />
      <RectangleSVG2D
        v-if="placingRuler"
        :key="placingRuler.id"
        :view-id="viewId"
        :point1="placingRuler.firstPoint"
        :point2="placingRuler.secondPoint"
        :color="placingRuler.color"
      />
    </svg>
    <RulerWidget2D
      v-for="ruler in rulers"
      :key="ruler.id"
      :ruler-id="ruler.id"
      :current-slice="currentSlice"
      :view-id="viewId"
      :view-direction="viewDirection"
      :widget-manager="widgetManager"
      @contextmenu="openContextMenu(ruler.id, $event)"
    />
    <RulerWidget2D
      v-if="placingRuler"
      :key="placingRuler.id"
      :ruler-id="placingRuler.id"
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
        <v-list-item @click="deleteRulerFromContextMenu">
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
import RulerWidget2D from '@/src/components/tools/ruler/RulerWidget2D.vue';
import RectangleSVG2D from '@/src/components/tools/rectangle/RectangleSVG2D.vue';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { Vector2 } from '@kitware/vtk.js/types';
import { LPSAxisDir } from '@/src/types/lps';
import { frameOfReferenceToImageSliceAndAxis } from '@/src/utils/frameOfReference';
import {
  useRectangleStore,
  PlacingToolID,
  ToolID,
  Tool,
} from '@/src/store/tools/rectangles';

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
    RulerWidget2D,
    RectangleSVG2D,
  },
  setup(props) {
    const { viewDirection } = toRefs(props);
    const toolStore = useToolStore();
    const rectangleStore = useRectangleStore();
    const { placingToolByID, tools } = storeToRefs(rectangleStore);

    const placingToolID = ref<PlacingToolID | null>(null);
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
      forRulerID: '' as ToolID,
    });

    const openContextMenu = (rulerID: ToolID, displayXY: Vector2) => {
      [contextMenu.x, contextMenu.y] = displayXY;
      contextMenu.show = true;
      contextMenu.forRulerID = rulerID;
    };

    const deleteRulerFromContextMenu = () => {
      rectangleStore.removeTool(contextMenu.forRulerID);
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

    const currentRulers = computed(() => {
      const curImageID = currentImageID.value;

      const rulerData = tools.value.filter((tool) => {
        // only show tools for the current image
        // and current view axis
        return tool.imageID === curImageID && doesToolFrameMatchViewAxis(tool);
      });

      return rulerData;
    });

    return {
      rulers: currentRulers,
      placingRuler: placingTool,
      contextMenu,
      openContextMenu,
      deleteRulerFromContextMenu,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
