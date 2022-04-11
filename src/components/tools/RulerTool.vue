<template>
  <div class="overlay">
    <svg class="overlay">
      <RulerSVG2D
        v-for="ruler in rulers"
        :key="ruler.id"
        v-show="currentSlice === ruler.slice"
        :point1="ruler.firstPointDisplay"
        :point2="ruler.secondPointDisplay"
      />
    </svg>
    <div>
      <RulerWidget2D
        v-for="ruler in rulers"
        :key="ruler.id"
        :ruler-id="ruler.id"
        :slice="currentSlice"
        :view-id="viewID"
        :view-direction="viewDirection"
        :view-up="viewUp"
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
import RulerWidget2D from '@/src/tools/ruler/RulerWidget2D.vue';
import RulerSVG2D from '@/src/tools/ruler/RulerSVG2D.vue';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { manageVTKSubscription } from '@/src/composables/manageVTKSubscription';
import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import { createPlaneManipulatorFor2DView } from '@/src/utils/manipulators';
import { Vector3 } from '@kitware/vtk.js/types';
import { InteractionState } from '@/src/vtk/RulerWidget/state';
import { worldToSVG } from '@/src/utils/vtk-helpers';

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
    viewUp: {
      type: String as PropType<LPSAxisDir>,
      required: true,
    },
    widgetManager: {
      type: Object as PropType<vtkWidgetManager>,
      required: true,
    },
    viewProxy: {
      type: Object as PropType<vtkViewProxy>,
      required: true,
    },
  },
  components: {
    RulerWidget2D,
    RulerSVG2D,
  },
  setup(props) {
    const {
      viewId: viewID,
      viewDirection,
      viewProxy: viewProxyRef,
    } = toRefs(props);
    const view2DStore = useView2DStore();
    const toolStore = useToolStore();
    const rulerStore = useRulerToolStore();
    const viewProxy = viewProxyRef.value;

    const { currentImageID, currentImageMetadata } = useCurrentImage();
    const currentSlice = computed(
      () => view2DStore.sliceConfigs[viewID.value].slice
    );
    const active = computed(() => toolStore.currentTool === Tools.Ruler);
    const activeRulerID = computed(() => rulerStore.activeRulerID);
    const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));

    const interactor = viewProxy.getInteractor();

    const deleteActiveRuler = () => {
      if (activeRulerID.value) {
        rulerStore.removeRuler(activeRulerID.value);
      }
    };

    const startNewRuler = (eventData: any) => {
      if (activeRulerID.value) {
        return;
      }
      if (currentImageID.value) {
        const id = rulerStore.addNewRuler({
          name: 'Ruler',
          imageID: currentImageID.value,
        });
        const manipulator = createPlaneManipulatorFor2DView(
          viewDirection.value,
          currentSlice.value,
          currentImageMetadata.value
        );
        const coords = manipulator.handleEvent(
          eventData,
          viewProxy.getOpenglRenderWindow()
        );
        if (coords.length) {
          rulerStore.updateRuler(id, {
            firstPoint: coords as Vector3,
            slice: currentSlice.value,
            imageID: currentImageID.value,
            viewAxis: viewAxis.value,
            interactionState: InteractionState.PlacingSecond,
          });
        }
        rulerStore.activateRuler(id);
      }
    };

    manageVTKSubscription(interactor.onMouseMove(() => {}));
    manageVTKSubscription(interactor.onLeftButtonPress(startNewRuler));

    // delete active ruler if slice changes
    watch(currentSlice, () => {
      deleteActiveRuler();
    });

    const renderer = viewProxy.getRenderer();

    const currentRulers = computed(() => {
      const rulerByID = rulerStore.rulers;
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
            firstPointDisplay: ruler.firstPoint
              ? worldToSVG(ruler.firstPoint, renderer)
              : null,
            secondPointDisplay: ruler.secondPoint
              ? worldToSVG(ruler.secondPoint, renderer)
              : null,
            slice: ruler.slice,
            focused: isToolActive && curActiveRulerID === id,
          };
        });
    });

    return {
      rulers: currentRulers,
      currentSlice,
      viewID,
    };
  },
});
</script>

<style scoped src="@/src/assets/styles/vtk-view.css"></style>
