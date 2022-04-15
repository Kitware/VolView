<template>
  <div class="overlay">
    <svg class="overlay">
      <RulerSVG2D
        v-for="ruler in rulers"
        :key="ruler.id"
        v-show="currentSlice === ruler.slice"
        :view-id="viewId"
        :point1="ruler.firstPoint"
        :point2="ruler.secondPoint"
        :length="ruler.length"
      />
    </svg>
    <div>
      <RulerWidget2D
        v-for="ruler in rulers"
        :key="ruler.id"
        :ruler-id="ruler.id"
        :slice="currentSlice"
        :view-id="viewId"
        :view-direction="viewDirection"
        :focused="ruler.focused"
        :widget-manager="widgetManager"
      />
    </div>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  PropType,
  toRefs,
  watch,
} from '@vue/composition-api';
import { useView2DStore } from '@/src/storex/views-2D';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { Tools, useToolStore } from '@/src/store/tools';
import { useRulerToolStore } from '@/src/store/tools/rulers';
import { getLPSAxisFromDir, LPSAxisDir } from '@/src/utils/lps';
import RulerWidget2D from '@/src/components/tools/ruler/RulerWidget2D.vue';
import RulerSVG2D from '@/src/components/tools/ruler/RulerSVG2D.vue';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { manageVTKSubscription } from '@/src/composables/manageVTKSubscription';
import { EVENT_ABORT, VOID } from '@kitware/vtk.js/macros';
import { shouldIgnoreEvent } from '@/src/vtk/RulerWidget';
import { useViewStore } from '@/src/storex/views';
import vtkLPSView2DProxy from '@/src/vtk/LPSView2DProxy';

export default defineComponent({
  name: 'RulerTool',
  props: {
    viewId: {
      type: String,
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
    const view2DStore = useView2DStore();
    const toolStore = useToolStore();
    const rulerStore = useRulerToolStore();

    const viewProxy = viewStore.getViewProxy<vtkLPSView2DProxy>(viewID.value);
    if (!viewProxy) {
      throw new Error('Cannot get the view proxy');
    }

    const { currentImageID } = useCurrentImage();
    const currentSlice = computed(
      () => view2DStore.sliceConfigs[viewID.value].slice
    );
    const active = computed(() => toolStore.currentTool === Tools.Ruler);
    const activeRulerID = computed(() => rulerStore.activeRulerID);
    const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));

    const deleteActiveRuler = () => {
      rulerStore.removeActiveRuler();
    };

    const startNewRuler = (eventData: any) => {
      if (!active.value || shouldIgnoreEvent(eventData)) {
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
    const interactor = viewProxy.getInteractor();
    manageVTKSubscription(interactor.onLeftButtonPress(startNewRuler));

    // delete active ruler if slice changes
    watch(currentSlice, () => {
      deleteActiveRuler();
    });

    const currentRulers = computed(() => {
      const rulerByID = rulerStore.rulers;
      const curImageID = currentImageID.value;
      const isToolActive = active.value;
      const curViewAxis = viewAxis.value;
      const curActiveRulerID = activeRulerID.value;
      const lengthByID = rulerStore.lengths;

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
            slice: ruler.slice,
            length: lengthByID[id],
            focused: isToolActive && curActiveRulerID === id,
          };
        });
    });

    return {
      rulers: currentRulers,
      currentSlice,
    };
  },
});
</script>

<style scoped src="@/src/assets/styles/vtk-view.css"></style>
