<script lang="ts">
import vtkRulerWidget, {
  InteractionState,
  vtkRulerViewWidget,
  vtkRulerWidgetPointState,
} from '@/src/vtk/RulerWidget';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import {
  computed,
  defineComponent,
  onMounted,
  onUnmounted,
  PropType,
  Ref,
  ref,
  toRefs,
  watch,
  watchEffect,
} from 'vue';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { updatePlaneManipulatorFor2DView } from '@/src/utils/manipulators';
import { LPSAxisDir } from '@/src/types/lps';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useVTKCallback } from '@/src/composables/useVTKCallback';
import RulerSVG2D from '@/src/components/tools/ruler/RulerSVG2D.vue';
import { watchOnce } from '@vueuse/core';
import { useRightClickContextMenu } from '@/src/composables/annotationTool';

export default defineComponent({
  name: 'RulerWidget2D',
  emits: ['placed', 'contextmenu'],
  props: {
    rulerId: {
      type: String,
      required: true,
    },
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
    isPlacing: {
      type: Boolean,
      default: false,
    },
  },
  components: {
    RulerSVG2D,
  },
  setup(props, { emit }) {
    const { rulerId, widgetManager, viewDirection, currentSlice, isPlacing } =
      toRefs(props);

    const rulerStore = useRulerStore();
    const ruler = computed(() => rulerStore.rulerByID[rulerId.value]);
    const { currentImageID, currentImageMetadata } = useCurrentImage();

    const widgetFactory = vtkRulerWidget.newInstance({
      id: rulerId.value,
      store: rulerStore,
      isPlaced: !isPlacing.value,
    });
    const widget = ref<vtkRulerViewWidget | null>(null);

    onMounted(() => {
      widget.value = widgetManager.value.addWidget(
        widgetFactory
      ) as vtkRulerViewWidget;
    });

    onUnmounted(() => {
      if (!widget.value) {
        return;
      }
      widgetManager.value.removeWidget(widget.value);
      widget.value.delete();
      widgetFactory.delete();
    });

    watch(
      [isPlacing, widget],
      ([placing, widget_]) => {
        if (placing && widget_) {
          widget_.setInteractionState(InteractionState.PlacingFirst);
        }
      },
      { immediate: true }
    );

    // --- reset on slice/image changes --- //

    watch([currentSlice, currentImageID, widget], () => {
      const isPlaced = widget.value?.getWidgetState().getIsPlaced();
      if (widget.value && !isPlaced) {
        widget.value.resetInteractions();
        widget.value.setInteractionState(InteractionState.PlacingFirst);
      }
    });

    // --- placed event --- //

    const onPlacedEvent = useVTKCallback(
      computed(() => widget.value?.onPlacedEvent)
    );

    onPlacedEvent(() => {
      emit('placed');
    });

    // --- right click handling --- //

    useRightClickContextMenu(emit, widget);

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
        ruler.value?.slice ?? currentSlice.value,
        currentImageMetadata.value
      );
    });

    // --- visibility --- //

    // toggles the pickability of the ruler handles,
    // since the 3D ruler parts are visually hidden.
    watch(
      () => !!widget.value && ruler.value?.slice === currentSlice.value,
      (visible) => {
        widget.value?.setVisibility(visible);
      },
      { immediate: true }
    );

    onMounted(() => {
      if (!widget.value) {
        return;
      }
      // hide handle visibility, but not picking visibility
      widget.value.setHandleVisibility(false);
      widgetManager.value.renderWidgets();
    });

    // --- handle pick visibility --- //

    const usePointVisibility = (
      pointState: Ref<vtkRulerWidgetPointState | undefined>
    ) => {
      const visible = ref(false);
      const updateVisibility = () => {
        if (!pointState.value) return;
        visible.value = pointState.value.getVisible();
      };

      const onModified = useVTKCallback(
        computed(() => pointState.value?.onModified)
      );
      onModified(() => updateVisibility());

      watchOnce(pointState, () => updateVisibility());

      return visible;
    };

    const firstPointVisible = usePointVisibility(
      computed(() => widget.value?.getWidgetState().getFirstPoint())
    );
    const secondPointVisible = usePointVisibility(
      computed(() => widget.value?.getWidgetState().getSecondPoint())
    );

    return {
      ruler,
      firstPoint: computed(() => {
        return firstPointVisible.value ? ruler.value.firstPoint : undefined;
      }),
      secondPoint: computed(() => {
        return secondPointVisible.value ? ruler.value.secondPoint : undefined;
      }),
      length: computed(() => rulerStore.lengthByID[ruler.value.id]),
    };
  },
});
</script>

<template>
  <RulerSVG2D
    v-show="currentSlice === ruler.slice"
    :view-id="viewId"
    :point1="firstPoint"
    :point2="secondPoint"
    :color="ruler.color"
    :length="length"
  />
</template>
