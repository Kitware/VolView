<script lang="ts">
import vtkRulerWidget, {
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
import { useRulerStore } from '@/src/store/tools/rulers';
import RulerSVG2D from '@/src/components/tools/ruler/RulerSVG2D.vue';
import { useRightClickContextMenu } from '@/src/composables/annotationTool';
import createRulerWidgetState from '@/src/vtk/RulerWidget/storeState';
import { useViewStore } from '@/src/store/views';
import { useSyncedRulerState } from '@/src/components/tools/ruler/common';
import { useViewWidget } from '@/src/composables/useViewWidget';

export default defineComponent({
  name: 'RulerWidget2D',
  emits: ['contextmenu'],
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
  },
  components: {
    RulerSVG2D,
  },
  setup(props, { emit }) {
    const { toolId, widgetManager, viewDirection, currentSlice, viewId } =
      toRefs(props);

    const rulerStore = useRulerStore();
    const ruler = computed(() => rulerStore.rulerByID[toolId.value]);
    const viewProxy = computed(() => useViewStore().getViewProxy(viewId.value));

    const widgetState = createRulerWidgetState({
      id: toolId.value,
      store: rulerStore,
    }) as vtkRulerWidgetState;
    const widgetFactory = vtkRulerWidget.newInstance({
      widgetState,
    });

    const syncedState = useSyncedRulerState(widgetFactory);
    const widget = useViewWidget<vtkRulerViewWidget>(
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

    // --- //

    return {
      ruler,
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
    v-show="currentSlice === ruler.slice"
    :view-id="viewId"
    :point1="firstPoint"
    :point2="secondPoint"
    :color="ruler.color"
    :length="length"
  />
</template>
