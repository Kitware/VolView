<script lang="ts">
import vtkRulerWidget, {
  InteractionState,
  vtkRulerViewWidget,
  vtkRulerWidgetState,
} from '@/src/vtk/RulerWidget';
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
import RulerSVG2D from '@/src/components/tools/ruler/RulerSVG2D.vue';
import createStandaloneState from '@/src/vtk/RulerWidget/standaloneState';
import {
  RulerInitState,
  useSyncedRulerState,
} from '@/src/components/tools/ruler/common';
import { useViewWidget } from '@/src/composables/useViewWidget';
import { useRulerStore } from '@/src/store/tools/rulers';

type ToolStore = ReturnType<typeof useRulerStore>;

export default defineComponent({
  name: 'PlacingRulerWidget2D',
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
    labelProps: {
      type: Object as PropType<ToolStore['labels'][string]>,
    },
  },
  components: {
    RulerSVG2D,
  },
  setup(props, { emit }) {
    const { widgetManager, viewDirection, currentSlice } = toRefs(props);

    const { currentImageID, currentImageMetadata } = useCurrentImage();

    const widgetState = createStandaloneState() as vtkRulerWidgetState;
    const widgetFactory = vtkRulerWidget.newInstance({
      widgetState,
    });

    const syncedState = useSyncedRulerState(widgetFactory);
    const widget = useViewWidget<vtkRulerViewWidget>(
      widgetFactory,
      widgetManager
    );

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
      const initState: RulerInitState = {
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

    // --- //

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
      length: computed(() => syncedState.length),
    };
  },
});
</script>

<template>
  <RulerSVG2D
    :view-id="viewId"
    :point1="firstPoint"
    :point2="secondPoint"
    :length="length"
    :color="labelProps?.color"
  />
</template>
