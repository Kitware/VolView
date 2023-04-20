<script lang="ts">
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import {
  computed,
  defineComponent,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  PropType,
  Ref,
  ref,
  toRefs,
  watch,
  watchEffect,
} from '@vue/composition-api';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { updatePlaneManipulatorFor2DView } from '@/src/utils/manipulators';
import { vtkSubscription } from '@kitware/vtk.js/interfaces';
import { getCSSCoordinatesFromEvent } from '@/src/utils/vtk-helpers';
import { LPSAxisDir } from '@/src/types/lps';
import { useVTKCallback } from '@/src/composables/useVTKCallback';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import vtkRectangleWidget, {
  vtkRectangleViewWidget,
  InteractionState,
} from '@/src/vtk/RectangleWidget';
import RectangleSVG2D from '@/src/components/tools/rectangle/RectangleSVG2D.vue';
import { vtkRulerWidgetPointState } from '@/src/vtk/RulerWidget';
import { watchOnce } from '@vueuse/core';
import { RectangleID } from '@/src/types/rectangle';

const useStore = useRectangleStore;
const vtkWidgetFactory = vtkRectangleWidget;
type WidgetView = vtkRectangleViewWidget;
type vtkWidgetPointState = vtkRulerWidgetPointState;
type ToolID = RectangleID;
const SVG2DComponent = RectangleSVG2D;

export default defineComponent({
  name: 'RectangleWidget2D',
  emits: ['placed'],
  props: {
    toolId: {
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
    SVG2DComponent,
  },
  setup(props, { emit }) {
    const {
      toolId: stringToolId,
      widgetManager,
      viewDirection,
      currentSlice,
      isPlacing,
    } = toRefs(props);
    const toolId = ref(stringToolId.value) as Ref<ToolID>;

    const toolStore = useStore();
    const tool = computed(() => toolStore.toolByID[toolId.value]);
    const { currentImageID, currentImageMetadata } = useCurrentImage();

    const widgetFactory = vtkWidgetFactory.newInstance({
      id: toolId.value,
      store: toolStore,
      isPlaced: !isPlacing.value,
    });
    const widget = ref<WidgetView | null>(null);

    onMounted(() => {
      widget.value = widgetManager.value.addWidget(widgetFactory) as WidgetView;
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

    const onPlacedEvent = useVTKCallback(
      computed(() => widget.value?.onPlacedEvent)
    );

    onPlacedEvent(() => {
      emit('placed');
    });

    // --- right click handling --- //

    let rightClickSub: vtkSubscription | null = null;

    onMounted(() => {
      if (!widget.value) {
        return;
      }
      rightClickSub = widget.value.onRightClickEvent((eventData) => {
        const coords = getCSSCoordinatesFromEvent(eventData);
        if (coords) {
          emit('contextmenu', coords);
        }
      });
    });

    onBeforeUnmount(() => {
      if (rightClickSub) {
        rightClickSub.unsubscribe();
        rightClickSub = null;
      }
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
        tool.value?.slice ?? currentSlice.value,
        currentImageMetadata.value
      );
    });

    // --- visibility --- //

    // toggles the pickability of the tool handles,
    // since the 3D tool parts are visually hidden.
    watch(
      () => !!widget.value && tool.value?.slice === currentSlice.value,
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
      pointState: Ref<vtkWidgetPointState | undefined>
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
      watchOnce(widget, () => updateVisibility());
      return visible;
    };

    const firstPointVisible = usePointVisibility(
      computed(() => widget.value?.getWidgetState().getFirstPoint())
    );
    const secondPointVisible = usePointVisibility(
      computed(() => widget.value?.getWidgetState().getSecondPoint())
    );

    return {
      tool,
      firstPoint: computed(() => {
        return firstPointVisible.value ? tool.value.firstPoint : undefined;
      }),
      secondPoint: computed(() => {
        return secondPointVisible.value ? tool.value.secondPoint : undefined;
      }),
    };
  },
});
</script>

<template>
  <SVG2DComponent
    v-show="currentSlice === tool.slice"
    :view-id="viewId"
    :point1="firstPoint"
    :point2="secondPoint"
    :color="tool.color"
  />
</template>
