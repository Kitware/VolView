<script lang="ts">
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import {
  computed,
  defineComponent,
  onMounted,
  onUnmounted,
  PropType,
  toRefs,
  watch,
  watchEffect,
} from 'vue';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { updatePlaneManipulatorFor2DView } from '@/src/utils/manipulators';
import { LPSAxisDir } from '@/src/types/lps';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import vtkWidgetFactory, {
  vtkPolygonViewWidget,
  vtkPolygonWidgetState,
} from '@/src/vtk/PolygonWidget';
import createStandaloneState from '@/src/vtk/PolygonWidget/standaloneState';
import { useViewWidget } from '@/src/composables/useViewWidget';
import {
  useSyncedPolygonState,
  PolygonInitState,
} from '@/src/components/tools/polygon/common';
import SVG2DComponent from './PolygonSVG2D.vue';

export default defineComponent({
  name: 'PlacingPolygonWidget2D',
  emits: ['placed'],
  props: {
    widgetManager: {
      type: Object as PropType<vtkWidgetManager>,
      required: true,
    },
    viewId: {
      type: String,
      required: true,
    },
    viewDirection: {
      type: String as PropType<LPSAxisDir>,
      required: true,
    },
    currentSlice: {
      type: Number,
      required: true,
    },
    color: String,
  },
  components: {
    SVG2DComponent,
  },
  setup(props, { emit }) {
    const { widgetManager, viewDirection, currentSlice } = toRefs(props);
    const { currentImageID, currentImageMetadata } = useCurrentImage();

    const widgetState = createStandaloneState() as vtkPolygonWidgetState;
    const widgetFactory = vtkWidgetFactory.newInstance({
      widgetState,
    });

    const syncedState = useSyncedPolygonState(widgetFactory);
    const widget = useViewWidget<vtkPolygonViewWidget>(
      widgetFactory,
      widgetManager
    );

    onMounted(() => {
      widgetState.setPlacing(true);
    });

    onUnmounted(() => {
      widgetFactory.delete();
    });

    // --- reset on slice/image changes --- //

    watch([currentSlice, currentImageID, widget], () => {
      if (widget.value) {
        widget.value.resetInteractions();
        widget.value.getWidgetState().clearHandleList();
      }
    });

    onVTKEvent(widget, 'onPlacedEvent', () => {
      const initState: PolygonInitState = {
        points: syncedState.points,
      };
      emit('placed', initState);

      widget.value?.reset();
      widgetState.setPlacing(true);
    });

    // --- manipulator --- //

    const manipulator = vtkPlaneManipulator.newInstance();

    onMounted(() => {
      if (!widget.value) {
        return;
      }
      widget.value.setManipulator(manipulator);
    });

    watchEffect(() => {
      updatePlaneManipulatorFor2DView(
        manipulator,
        viewDirection.value,
        currentSlice.value,
        currentImageMetadata.value
      );
    });

    // --- visibility --- //

    onMounted(() => {
      if (!widget.value) {
        return;
      }
      // hide handle visibility, but not picking visibility
      widget.value.setHandleVisibility(false);
      widgetManager.value.renderWidgets();
    });

    // // when movePoint/mouse changes, get finishable manually as its not in store
    // const finishable = ref(false);
    // // const movePoint = computed(() => tool.value?.movePoint);
    // watch([movePoint], () => {
    //   finishable.value = !!widget.value?.getWidgetState().getFinishable();
    // });

    return {
      state: syncedState,
      finishable: computed(() => syncedState.finishable),
    };
  },
});
</script>

<template>
  <SVG2DComponent
    :view-id="viewId"
    :points="state.points"
    :color="color"
    :move-point="state.movePoint"
    placing
    :finishable="finishable"
  />
</template>
