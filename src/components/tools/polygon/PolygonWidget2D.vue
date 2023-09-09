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
import { useRightClickContextMenu } from '@/src/composables/annotationTool';
import { usePolygonStore as useStore } from '@/src/store/tools/polygons';
import { PolygonID as ToolID } from '@/src/types/polygon';
import vtkWidgetFactory, {
  vtkPolygonViewWidget,
  vtkPolygonWidgetState,
} from '@/src/vtk/PolygonWidget';
import { useViewStore } from '@/src/store/views';
import createPolygonWidgetState from '@/src/vtk/PolygonWidget/storeState';
import { useSyncedPolygonState } from '@/src/components/tools/polygon/common';
import { useViewWidget } from '@/src/composables/useViewWidget';
import SVG2DComponent from './PolygonSVG2D.vue';

export default defineComponent({
  name: 'PolygonWidget2D',
  emits: ['contextmenu'],
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
  },
  components: {
    SVG2DComponent,
  },
  setup(props, { emit }) {
    const { toolId, widgetManager, viewDirection, currentSlice, viewId } =
      toRefs(props);

    const toolStore = useStore();
    const tool = computed(() => toolStore.toolByID[toolId.value]);
    const viewProxy = computed(() => useViewStore().getViewProxy(viewId.value));

    const widgetState = createPolygonWidgetState({
      id: toolId.value,
      store: toolStore,
    }) as vtkPolygonWidgetState;
    const widgetFactory = vtkWidgetFactory.newInstance({
      widgetState,
    });

    const syncedState = useSyncedPolygonState(widgetFactory);
    const widget = useViewWidget<vtkPolygonViewWidget>(
      widgetFactory,
      widgetManager
    );

    onMounted(() => {
      viewProxy.value?.renderLater();
    });

    onUnmounted(() => {
      widgetFactory.delete();
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

    const { currentImageMetadata } = useCurrentImage();

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
      state: syncedState,
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
    :finishable="state.finishable"
  />
</template>
