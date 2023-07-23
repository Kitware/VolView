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
} from 'vue';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { updatePlaneManipulatorFor2DView } from '@/src/utils/manipulators';
import type { vtkSubscription } from '@kitware/vtk.js/interfaces';
import { getCSSCoordinatesFromEvent } from '@/src/utils/vtk-helpers';
import { LPSAxisDir } from '@/src/types/lps';
import { useVTKCallback } from '@/src/composables/useVTKCallback';
import { usePolygonStore as useStore } from '@/src/store/tools/polygons';
import { PolygonID as ToolID } from '@/src/types/polygon';
import vtkWidgetFactory, {
  vtkPolygonViewWidget as WidgetView,
} from '@/src/vtk/PolygonWidget';
import SVG2DComponent from './PolygonSVG2D.vue';

export default defineComponent({
  name: 'PolygonWidget2D',
  emits: ['placed', 'contextmenu'],
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
          widget_.getWidgetState().clearHandles();
          widgetManager.value.renderWidgets();
          widgetManager.value.grabFocus(widget_);
        }
      },
      { immediate: true }
    );

    // --- reset on slice/image changes --- //

    watch([currentSlice, currentImageID, widget], () => {
      const isPlaced = widget.value?.getWidgetState().getIsPlaced();
      if (widget.value && !isPlaced) {
        widget.value.resetInteractions();
        widget.value.getWidgetState().clearHandles();
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
      if (!widget.value || widget.value.getWidgetState().getIsPlaced()) {
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

    return {
      tool,
    };
  },
});
</script>

<template>
  <SVG2DComponent
    v-show="currentSlice === tool.slice"
    :view-id="viewId"
    :points="tool.points"
    :color="tool.color"
    :move-point="tool.movePoint"
    :placing="tool.placing"
  />
</template>
