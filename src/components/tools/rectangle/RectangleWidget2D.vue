<script lang="ts">
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
  reactive,
} from 'vue';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { updatePlaneManipulatorFor2DView } from '@/src/utils/manipulators';
import { LPSAxisDir } from '@/src/types/lps';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import vtkRectangleWidget, {
  vtkRectangleViewWidget,
  InteractionState,
} from '@/src/vtk/RectangleWidget';
import RectangleSVG2D from '@/src/components/tools/rectangle/RectangleSVG2D.vue';
import { RectangleID } from '@/src/types/rectangle';
import {
  useRightClickContextMenu,
  useHoverEvent,
  useWidgetVisibility,
} from '@/src/composables/annotationTool';
import { vtkRulerWidgetState } from '@/src/vtk/RulerWidget';

const useStore = useRectangleStore;
const vtkWidgetFactory = vtkRectangleWidget;
type WidgetView = vtkRectangleViewWidget;
type ToolID = RectangleID;
const SVG2DComponent = RectangleSVG2D;

export default defineComponent({
  name: 'RectangleWidget2D',
  emits: ['placed', 'contextmenu', 'widgetHover'],
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
      viewId,
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

    onVTKEvent(widget, 'onPlacedEvent', () => {
      emit('placed');
    });

    useHoverEvent(emit, widget);

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
        tool.value?.slice ?? currentSlice.value,
        currentImageMetadata.value
      );
    });

    // --- visibility --- //

    const isVisible = computed(() => tool.value?.slice === currentSlice.value);
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
      tool,
      firstPoint: computed(() => {
        return visibleStates.firstPoint ? tool.value.firstPoint : undefined;
      }),
      secondPoint: computed(() => {
        return visibleStates.secondPoint ? tool.value.secondPoint : undefined;
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
    :fill-color="tool.fillColor"
  />
</template>
