<template>
  <div class="overlay-no-events">
    <svg class="overlay-no-events">
      <RulerSVG2D
        v-for="ruler in rulers"
        :key="ruler.id"
        v-show="slice === ruler.slice"
        :view-id="viewId"
        :point1="ruler.firstPoint"
        :point2="ruler.secondPoint"
        :color="ruler.color"
        :length="ruler.length"
      />
    </svg>
    <div>
      <RulerWidget2D
        v-for="ruler in rulers"
        :key="ruler.id"
        :ruler-id="ruler.id"
        :slice="slice"
        :view-id="viewId"
        :view-direction="viewDirection"
        :focused="ruler.focused"
        :widget-manager="widgetManager"
        @contextmenu="openContextMenu(ruler.id, $event)"
      />
    </div>
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
  toRefs,
  watch,
} from '@vue/composition-api';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { Tools, useToolStore } from '@/src/store/tools';
import { useRulerStore } from '@/src/store/tools/rulers';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import RulerWidget2D from '@/src/components/tools/ruler/RulerWidget2D.vue';
import RulerSVG2D from '@/src/components/tools/ruler/RulerSVG2D.vue';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { EVENT_ABORT, VOID } from '@kitware/vtk.js/macros';
import { shouldIgnoreEvent } from '@/src/vtk/RulerWidget';
import { useViewStore } from '@/src/store/views';
import vtkLPSView2DProxy from '@/src/vtk/LPSView2DProxy';
import { Vector2 } from '@kitware/vtk.js/types';
import { LPSAxisDir } from '@/src/types/lps';
import { useVTKCallback } from '@/src/composables/useVTKCallback';

export default defineComponent({
  name: 'RulerTool',
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
    RulerWidget2D,
    RulerSVG2D,
  },
  setup(props) {
    const { viewId: viewID, viewDirection } = toRefs(props);
    const viewStore = useViewStore();
    const toolStore = useToolStore();
    const rulerStore = useRulerStore();

    const viewProxy = computed(
      () => viewStore.getViewProxy<vtkLPSView2DProxy>(viewID.value)!
    );

    const { currentImageID } = useCurrentImage();
    const active = computed(() => toolStore.currentTool === Tools.Ruler);
    const activeRulerID = computed(() => rulerStore.activeRulerID);
    const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));

    // --- context menu --- //

    const contextMenu = reactive({
      show: false,
      x: 0,
      y: 0,
      forRulerID: '',
    });

    const openContextMenu = (rulerID: string, displayXY: Vector2) => {
      [contextMenu.x, contextMenu.y] = displayXY;
      contextMenu.show = true;
      contextMenu.forRulerID = rulerID;
    };

    const deleteRulerFromContextMenu = () => {
      rulerStore.removeRuler(contextMenu.forRulerID);
    };

    // --- ruler lifecycle --- //

    const deleteActiveRuler = () => {
      rulerStore.removeActiveRuler();
    };

    const startNewRuler = (eventData: any) => {
      if (!active.value || contextMenu.show || shouldIgnoreEvent(eventData)) {
        return VOID;
      }
      rulerStore.addNewRulerFromViewEvent(eventData, viewID.value);
      return EVENT_ABORT;
    };

    // We don't create a ruler until we receive a click, so
    // the button press listener must be here rather than in
    // the widget itself.
    // We may support configuring which mouse button triggers this tool
    // in the future.
    const onLeftButtonPress = useVTKCallback(
      computed(() => viewProxy.value.getInteractor().onLeftButtonPress)
    );
    onLeftButtonPress(startNewRuler);

    // delete active ruler if slice changes
    watch(
      () => props.slice,
      () => {
        deleteActiveRuler();
      }
    );

    // --- ruler data --- //

    const currentRulers = computed(() => {
      const { rulers: rulerByID, lengthByID } = rulerStore;
      const curImageID = currentImageID.value;
      const isToolActive = active.value;
      const curViewAxis = viewAxis.value;
      const curActiveRulerID = activeRulerID.value;

      return rulerStore.rulerIDs
        .map((id) => ({ id, ruler: rulerByID[id] }))
        .filter(({ ruler }) => {
          // only show rulers for the current image and the current view
          return (
            ruler.imageID === curImageID &&
            (!ruler.viewAxis || ruler.viewAxis === curViewAxis)
          );
        })
        .map(({ id, ruler }) => {
          return {
            id,
            firstPoint: ruler.firstPoint,
            secondPoint: ruler.secondPoint,
            color: ruler.color,
            slice: ruler.slice,
            length: lengthByID[id],
            focused: isToolActive && curActiveRulerID === id,
          };
        });
    });

    return {
      rulers: currentRulers,
      contextMenu,
      openContextMenu,
      deleteRulerFromContextMenu,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
