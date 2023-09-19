<script lang="ts">
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
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import {
  useHoverEvent,
  useRightClickContextMenu,
  useWidgetVisibility,
} from '@/src/composables/annotationTool';
import { usePolygonStore as useStore } from '@/src/store/tools/polygons';
import { PolygonID as ToolID } from '@/src/types/polygon';
import vtkWidgetFactory, {
  vtkPolygonViewWidget as WidgetView,
} from '@/src/vtk/PolygonWidget';
import { Maybe } from '@/src/types';
import { Vector3 } from '@kitware/vtk.js/types';
import { useViewStore } from '@/src/store/views';
import {
  useViewProxyMounted,
  useViewProxyUnmounted,
} from '@/src/composables/useViewProxy';
import SVG2DComponent from './PolygonSVG2D.vue';

export default defineComponent({
  name: 'PolygonWidget2D',
  emits: ['placed', 'contextmenu', 'widgetHover'],
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
    SVG2DComponent,
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

    const toolStore = useStore();
    const tool = computed(() => toolStore.toolByID[toolId.value]);
    const { currentImageID, currentImageMetadata } = useCurrentImage();
    const viewProxy = computed(
      () => useViewStore().getViewProxy(viewId.value)!
    );

    const widgetFactory = vtkWidgetFactory.newInstance({
      id: toolId.value,
      store: toolStore,
    });
    const widget = ref<WidgetView | null>(null);

    useViewProxyMounted(viewProxy, () => {
      widget.value = widgetManager.value.addWidget(widgetFactory) as WidgetView;
    });

    useViewProxyUnmounted(viewProxy, () => {
      if (!widget.value) {
        return;
      }
      widgetManager.value.removeWidget(widget.value);
      widget.value.delete();
      widgetFactory.delete();
    });

    // --- reset on slice/image changes --- //

    watch([currentSlice, currentImageID, widget], () => {
      if (widget.value && isPlacing.value) {
        widget.value.resetInteractions();
        widget.value.getWidgetState().clearHandles();
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

    useViewProxyMounted(viewProxy, () => {
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

    // --- //

    const editState = reactive({
      movePoint: null as Maybe<Vector3>,
      finishable: false,
    });

    const widgetState = widgetFactory.getWidgetState();
    onVTKEvent(widgetState, 'onModified', () => {
      editState.movePoint = widgetState.getMoveHandle().getOrigin();
      editState.finishable = widgetState.getFinishable();
    });

    return {
      tool,
      editState,
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
    :move-point="editState.movePoint"
    :placing="tool.placing"
    :finishable="editState.finishable"
  />
</template>
