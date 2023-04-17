<script lang="ts">
import vtkRulerWidget, { vtkRulerViewWidget } from '@/src/vtk/RulerWidget';
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
import { FrameOfReference } from '@/src/utils/frameOfReference';
import { Vector3 } from '@kitware/vtk.js/types';
import { ToolID, useRectangleStore } from '@/src/store/tools/rectangles';

const useStore = useRectangleStore;
const vtkWidgetFactory = vtkRulerWidget;
type WidgetView = vtkRulerViewWidget;

export default defineComponent({
  name: 'RectangleWidget2D',
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
  setup(props, { emit }) {
    const {
      toolId: stringToolId,
      widgetManager,
      viewDirection,
      currentSlice,
    } = toRefs(props);
    const toolId = ref(stringToolId.value) as Ref<ToolID>;

    const toolStore = useStore();
    const isPlacingTool = computed(() => toolStore.isPlacingTool(toolId.value));
    const tool = computed(() =>
      isPlacingTool.value
        ? toolStore.placingToolByID[toolId.value]
        : toolStore.toolByID[toolId.value]
    );
    const { currentImageID, currentImageMetadata } = useCurrentImage();

    const widgetFactory = vtkWidgetFactory.newInstance({
      id: toolId.value,
      store: toolStore,
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

    // --- placing tool reset --- //

    // reset placing tool when changing slices or images
    watch([currentSlice, currentImageID, isPlacingTool], () => {
      if (!isPlacingTool.value || !widget.value) return;
      toolStore.resetPlacingTool(toolId.value);
      widget.value.resetInteractionState();
    });

    // --- placing tool finalization --- //

    const getCurrentFrameOfReference = (): FrameOfReference => {
      const planeNormal = currentImageMetadata.value.lpsOrientation[
        viewDirection.value
      ] as Vector3;
      const planeOrigin = tool.value!.firstPoint!;
      return {
        planeNormal,
        planeOrigin,
      };
    };

    // this only happens for the placing tool
    const onFinalizedEvent = useVTKCallback(
      computed(() => widget.value?.onFinalizedEvent)
    );

    onFinalizedEvent(() => {
      if (!currentImageID.value || !isPlacingTool.value || !widget.value) {
        return;
      }
      // set name + imageID + frame + slice
      toolStore.updateTool(toolId.value, {
        name: 'Tool',
        imageID: currentImageID.value,
        slice: currentSlice.value,
        frameOfReference: getCurrentFrameOfReference(),
      });

      // resets the widget and the backing placing tool
      toolStore.commitPlacingTool(toolId.value);
      widget.value.resetInteractionState();
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

    // technically toggles the pickability of the tool
    // handles, since the 3D tool parts are visually hidden.
    watch(
      () => tool.value?.slice === currentSlice.value,
      (visible) => {
        widget.value?.setVisibility(visible);
      }
    );

    onMounted(() => {
      if (!widget.value) {
        return;
      }
      // hide handle visibility, but not picking visibility
      widget.value.setHandleVisibility(false);
      widgetManager.value.renderWidgets();
    });

    return () => null;
  },
});
</script>
