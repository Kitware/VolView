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
import vtkRectangleWidget, {
  vtkRectangleViewWidget,
  InteractionState,
  vtkRectangleWidgetState,
} from '@/src/vtk/RectangleWidget';
import RectangleSVG2D from '@/src/components/tools/rectangle/RectangleSVG2D.vue';
// the rectangle widget is the same as the ruler widget
import createStandaloneState from '@/src/vtk/RulerWidget/standaloneState';
import { useSyncedRectangleState } from '@/src/components/tools/rectangle/common';
import { useViewWidget } from '@/src/composables/useViewWidget';
import type { RectangleInitState } from '@/src/components/tools/rectangle/common';

const vtkWidgetFactory = vtkRectangleWidget;
type WidgetView = vtkRectangleViewWidget;
const SVG2DComponent = RectangleSVG2D;

export default defineComponent({
  name: 'RectangleWidget2D',
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
    fillColor: String,
  },
  components: {
    SVG2DComponent,
  },
  setup(props, { emit }) {
    const { widgetManager, viewDirection, currentSlice } = toRefs(props);

    const { currentImageID, currentImageMetadata } = useCurrentImage();

    const widgetState = createStandaloneState() as vtkRectangleWidgetState;
    const widgetFactory = vtkWidgetFactory.newInstance({
      widgetState,
    });

    const syncedState = useSyncedRectangleState(widgetFactory);
    const widget = useViewWidget<WidgetView>(widgetFactory, widgetManager);

    onMounted(() => {
      widget.value!.setInteractionState(InteractionState.PlacingFirst);
    });

    onUnmounted(() => {
      widgetFactory.delete();
    });

    // --- reset on slice/image changes --- //

    watch([currentSlice, currentImageID, widget], () => {
      if (widget.value) {
        widget.value.resetInteractions();
        widget.value.setInteractionState(InteractionState.PlacingFirst);
      }
    });

    // --- placed event --- //

    onVTKEvent(widget, 'onPlacedEvent', () => {
      const { firstPoint, secondPoint } = syncedState;
      if (!firstPoint.origin || !secondPoint.origin)
        throw new Error('Incomplete placing widget state');
      const initState: RectangleInitState = {
        firstPoint: firstPoint.origin,
        secondPoint: secondPoint.origin,
      };
      emit('placed', initState);

      widget.value?.resetState();
      widget.value?.setInteractionState(InteractionState.PlacingFirst);
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

    return {
      firstPoint: computed(() => {
        return syncedState.firstPoint.visible
          ? syncedState.firstPoint.origin
          : null;
      }),
      secondPoint: computed(() => {
        return syncedState.secondPoint.visible
          ? syncedState.secondPoint.origin
          : null;
      }),
    };
  },
});
</script>

<template>
  <SVG2DComponent
    :view-id="viewId"
    :point1="firstPoint"
    :point2="secondPoint"
    :color="color"
    :fill-color="fillColor"
  />
</template>
