<script lang="ts">
import {
  computed,
  defineComponent,
  PropType,
  toRefs,
  watch,
  watchEffect,
  reactive,
  inject,
  onUnmounted,
} from 'vue';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { useImage } from '@/src/composables/useCurrentImage';
import { updatePlaneManipulatorFor2DView } from '@/src/utils/manipulators';
import { LPSAxisDir } from '@/src/types/lps';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import vtkRectangleWidget, {
  vtkRectangleViewWidget,
  InteractionState,
} from '@/src/vtk/RectangleWidget';
import RectangleSVG2D from '@/src/components/tools/rectangle/RectangleSVG2D.vue';
import {
  useRightClickContextMenu,
  useHoverEvent,
  useWidgetVisibility,
} from '@/src/composables/annotationTool';
import { vtkRulerWidgetState } from '@/src/vtk/RulerWidget';
import { ToolID } from '@/src/types/annotation-tool';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useSliceInfo } from '@/src/composables/useSliceInfo';
import { Maybe } from '@/src/types';
import { whenever } from '@vueuse/core';

const useStore = useRectangleStore;
const vtkWidgetFactory = vtkRectangleWidget;
type WidgetView = vtkRectangleViewWidget;
const SVG2DComponent = RectangleSVG2D;

export default defineComponent({
  name: 'RectangleWidget2D',
  emits: ['placed', 'contextmenu', 'widgetHover'],
  props: {
    toolId: {
      type: String as unknown as PropType<ToolID>,
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
    isPlacing: {
      type: Boolean,
      default: false,
    },
    imageId: String as PropType<Maybe<string>>,
  },
  components: {
    SVG2DComponent,
  },
  setup(props, { emit }) {
    const { toolId, viewId, viewDirection, imageId, isPlacing } = toRefs(props);

    const view = inject(VtkViewContext);
    if (!view) throw new Error('No VtkView');

    const sliceInfo = useSliceInfo(viewId, imageId);
    const slice = computed(() => sliceInfo.value?.slice);

    const toolStore = useStore();
    const tool = computed(() => toolStore.toolByID[toolId.value]);
    const { metadata: imageMetadata } = useImage(imageId);

    const widgetFactory = vtkWidgetFactory.newInstance({
      id: toolId.value,
      isPlaced: !isPlacing.value,
    });

    const widget = view.widgetManager.addWidget(widgetFactory) as WidgetView;

    onUnmounted(() => {
      view.widgetManager.removeWidget(widget);
      widgetFactory.delete();
    });

    whenever(
      isPlacing,
      () => {
        widget.setInteractionState(InteractionState.PlacingFirst);
      },
      { immediate: true }
    );

    // --- reset on slice/image changes --- //

    watch([slice, imageId], () => {
      const isPlaced = widget.getWidgetState().getIsPlaced();
      if (!isPlaced) {
        widget.resetInteractions();
        widget.setInteractionState(InteractionState.PlacingFirst);
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
    widget.setManipulator(manipulator);

    watchEffect(() => {
      updatePlaneManipulatorFor2DView(
        manipulator,
        viewDirection.value,
        tool.value?.slice ?? slice.value,
        imageMetadata.value
      );
    });

    // --- visibility --- //

    const isVisible = computed(() => tool.value?.slice === slice.value);
    useWidgetVisibility(widget, isVisible, view);

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
      slice,
      firstPoint: computed(() => {
        return visibleStates.firstPoint ? tool.value?.firstPoint : undefined;
      }),
      secondPoint: computed(() => {
        return visibleStates.secondPoint ? tool.value?.secondPoint : undefined;
      }),
    };
  },
});
</script>

<template>
  <SVG2DComponent
    v-show="slice === tool.slice"
    :view-id="viewId"
    :point1="firstPoint"
    :point2="secondPoint"
    :color="tool.color"
    :stroke-width="tool.strokeWidth"
    :fill-color="tool.fillColor"
  />
</template>
