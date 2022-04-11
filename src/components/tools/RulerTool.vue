<template>
  <div class="overlay">
    <svg class="overlay">
      <!--
      <ruler-svg
        v-for="ruler in rulers"
        v-show="currentSlice === ruler.slice"
        :key="ruler.id"
        :point1="ruler.firstPoint"
        :point2="ruler.secondPoint"
      />
      -->
    </svg>
    <div>
      <component
        v-for="ruler in rulers"
        :key="ruler.id"
        :is="RulerWidgetComponent"
        :ruler-id="ruler.id"
        :slice="currentSlice"
        :view-id="viewID"
        :view-direction="viewDirection"
        :view-up="viewUp"
        :pickable="true"
        :focused="active && activeRulerID === ruler.id"
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
} from '@vue/composition-api';
import { useView2DStore } from '@/src/storex/views-2D';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { Tools, useToolStore } from '@/src/store/tools';
import { useRulerToolStore } from '@/src/store/tools/rulers';
import { getLPSAxisFromDir, LPSAxisDir } from '@/src/utils/lps';
import RulerWidget2D from '@/src/tools/ruler/RulerWidget2D.vue';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { manageVTKSubscription } from '@/src/composables/manageVTKSubscription';
import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import { createPlaneManipulatorFor2DView } from '@/src/utils/manipulators';
import { Vector3 } from '@kitware/vtk.js/types';
import { InteractionState } from '@/src/vtk/RulerWidget/state';

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
    viewType: {
      type: String as PropType<'2D' | '3D'>,
      required: true,
    },
    viewProxy: {
      type: Object as PropType<vtkViewProxy>,
      required: true,
    },
  },
  setup(props) {
    const {
      viewId: viewID,
      viewDirection,
      viewType,
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

    const startNewRuler = (eventData: any) => {
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
            interactionState: InteractionState.PlacingSecond,
          });
        }
      }
    };

    manageVTKSubscription(interactor.onMouseMove(() => {}));
    manageVTKSubscription(interactor.onLeftButtonPress(startNewRuler));

    const currentRulers = computed(() => {
      const rulerByID = rulerStore.rulers;
      const curImageID = currentImageID.value;
      return rulerStore.rulerIDs
        .filter((id) => {
          const ruler = rulerByID[id];
          return (
            ruler.imageID === curImageID &&
            // if the ruler has a view type, do not add to other views
            (!ruler.viewAxis || ruler.viewAxis === viewAxis.value)
          );
        })
        .map((id) => {
          const ruler = rulerByID[id];
          return {
            id,
            firstPoint: ruler.firstPoint,
            secondPoint: ruler.secondPoint,
            slice: ruler.slice,
          };
        });
    });

    const RulerWidgetComponent = viewType.value === '2D' ? RulerWidget2D : null;

    return {
      rulers: currentRulers,
      currentSlice,
      active,
      activeRulerID,
      viewID,
      RulerWidgetComponent,
    };
  },
});
</script>

<style scoped src="@/src/assets/styles/vtk-view.css"></style>
