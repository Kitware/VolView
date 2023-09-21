<script lang="ts">
import vtkRulerWidget, {
  InteractionState,
  vtkRulerViewWidget,
  vtkRulerWidgetState,
} from '@/src/vtk/RulerWidget';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import {
  reactive,
  computed,
  defineComponent,
  PropType,
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
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import RulerSVG2D from '@/src/components/tools/ruler/RulerSVG2D.vue';
import {
  useRightClickContextMenu,
  useHoverEvent,
  useWidgetVisibility,
} from '@/src/composables/annotationTool';
import { useViewStore } from '@/src/store/views';
import {
  onViewProxyMounted,
  onViewProxyUnmounted,
} from '@/src/composables/useViewProxy';
import { ToolID } from '@/src/types/annotation-tool';
import { ToolSelectEvent } from '@/src/store/tools/types';

export default defineComponent({
  name: 'RulerWidget2D',
  emits: ['placed', 'contextmenu', 'widgetHover', 'select'],
  props: {
    toolId: {
      type: String as unknown as PropType<ToolID>,
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
    const {
      toolId,
      viewId,
      widgetManager,
      viewDirection,
      currentSlice,
      isPlacing,
    } = toRefs(props);

    const rulerStore = useRulerStore();
    const ruler = computed(() => rulerStore.rulerByID[toolId.value]);
    const { currentImageID, currentImageMetadata } = useCurrentImage();
    const viewProxy = computed(() => useViewStore().getViewProxy(viewId.value));

    const widgetFactory = vtkRulerWidget.newInstance({
      id: toolId.value,
      isPlaced: !isPlacing.value,
    });
    const widget = ref<vtkRulerViewWidget | null>(null);

    onViewProxyMounted(viewProxy, () => {
      widget.value = widgetManager.value.addWidget(
        widgetFactory
      ) as vtkRulerViewWidget;
    });

    onViewProxyUnmounted(viewProxy, () => {
      if (!widget.value) {
        return;
      }
      // widgetManager calls widget.delete()
      widgetManager.value.removeWidget(widget.value);
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

    onVTKEvent(widget, 'onPlacedEvent', () => {
      emit('placed');
    });

    useHoverEvent(emit, widget);

    // --- selection handling --- //

    onVTKEvent(widget, 'onSelectEvent', (event: ToolSelectEvent) => {
      emit('select', event);
    });

    // --- right click handling --- //

    useRightClickContextMenu(emit, widget);

    // --- manipulator --- //

    const manipulator = vtkPlaneManipulator.newInstance();

    onViewProxyMounted(viewProxy, () => {
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

    const isVisible = computed(() => ruler.value?.slice === currentSlice.value);
    useWidgetVisibility(widget, isVisible, widgetManager, viewId);

    // --- handle pick visibility --- //

    const visibleStates = reactive({
      firstPoint: false,
      secondPoint: false,
    });

    const updateVisibleState = (widgetState: vtkRulerWidgetState) => {
      visibleStates.firstPoint = widgetState.getFirstPoint().getVisible();
      visibleStates.secondPoint = widgetState.getSecondPoint().getVisible();
    };

    const widgetState = widgetFactory.getWidgetState();
    onVTKEvent(widgetFactory.getWidgetState(), 'onModified', () =>
      updateVisibleState(widgetState)
    );
    updateVisibleState(widgetState);

    return {
      ruler,
      firstPoint: computed(() => {
        return visibleStates.firstPoint ? ruler.value.firstPoint : undefined;
      }),
      secondPoint: computed(() => {
        return visibleStates.secondPoint ? ruler.value.secondPoint : undefined;
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
    :strokeWidth="ruler.strokeWidth"
    :length="length"
  />
</template>
