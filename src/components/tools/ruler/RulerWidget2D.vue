<script lang="ts">
import vtkRulerWidget, {
  InteractionState,
  vtkRulerViewWidget,
  vtkRulerWidgetState,
} from '@/src/vtk/RulerWidget';
import {
  reactive,
  computed,
  defineComponent,
  PropType,
  toRefs,
  watch,
  watchEffect,
  inject,
  onUnmounted,
  onMounted,
} from 'vue';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { useImage } from '@/src/composables/useCurrentImage';
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
import { ToolID } from '@/src/types/annotation-tool';
import { Maybe } from '@/src/types';
import { useSliceInfo } from '@/src/composables/useSliceInfo';
import { VtkViewContext } from '@/src/components/vtk/context';
import { whenever } from '@vueuse/core';

export default defineComponent({
  name: 'RulerWidget2D',
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
    RulerSVG2D,
  },
  setup(props, { emit }) {
    const { toolId, viewId, viewDirection, imageId, isPlacing } = toRefs(props);

    const view = inject(VtkViewContext);
    if (!view) throw new Error('No VtkView');

    const sliceInfo = useSliceInfo(viewId, imageId);
    const slice = computed(() => sliceInfo.value?.slice ?? 0);

    const rulerStore = useRulerStore();
    const ruler = computed(() => rulerStore.rulerByID[toolId.value]);
    const { metadata: imageMetadata } = useImage(imageId);

    const widgetFactory = vtkRulerWidget.newInstance({
      id: toolId.value,
      isPlaced: !isPlacing.value,
    });
    const widget = view.widgetManager.addWidget(
      widgetFactory
    ) as vtkRulerViewWidget;

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

    // --- placed event --- //

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
        ruler.value?.slice ?? slice.value,
        imageMetadata.value
      );
    });

    // --- visibility --- //

    const isVisible = computed(() => ruler.value?.slice === slice.value);
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

    onMounted(() => {
      updateVisibleState(widgetState);
    });

    return {
      ruler,
      slice,
      firstPoint: computed(() => {
        return visibleStates.firstPoint ? ruler.value?.firstPoint : undefined;
      }),
      secondPoint: computed(() => {
        return visibleStates.secondPoint ? ruler.value?.secondPoint : undefined;
      }),
      length: computed(() => rulerStore.lengthByID[ruler.value.id]),
    };
  },
});
</script>

<template>
  <RulerSVG2D
    v-show="slice === ruler.slice"
    :point1="firstPoint"
    :point2="secondPoint"
    :color="ruler.color"
    :strokeWidth="ruler.strokeWidth"
    :length="length"
  />
</template>
