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
import { useRulerStore } from '@/src/store/tools/rulers';
import { useVTKCallback } from '@/src/composables/useVTKCallback';
import { FrameOfReference } from '@/src/utils/frameOfReference';
import { Vector3 } from '@kitware/vtk.js/types';

export default defineComponent({
  name: 'RulerWidget2D',
  props: {
    rulerId: {
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
    const { rulerId, widgetManager, viewDirection, currentSlice } =
      toRefs(props);

    const rulerStore = useRulerStore();
    const isPlacingRuler = computed(() =>
      rulerStore.isPlacingRuler(rulerId.value)
    );
    const ruler = computed(() =>
      isPlacingRuler.value
        ? rulerStore.placingRulerByID[rulerId.value]
        : rulerStore.rulerByID[rulerId.value]
    );
    const { currentImageID, currentImageMetadata } = useCurrentImage();

    const widgetFactory = vtkRulerWidget.newInstance({
      id: rulerId.value,
      store: rulerStore,
    });
    const widget = ref<vtkRulerViewWidget | null>(null);

    onMounted(() => {
      widget.value = widgetManager.value.addWidget(
        widgetFactory
      ) as vtkRulerViewWidget;
    });

    onUnmounted(() => {
      if (!widget.value) {
        return;
      }
      widgetManager.value.removeWidget(widget.value);
      widget.value.delete();
      widgetFactory.delete();
    });

    // --- placing ruler reset --- //

    // reset placing ruler when changing slices or images
    watch([currentSlice, currentImageID, isPlacingRuler], () => {
      if (!isPlacingRuler.value || !widget.value) return;
      rulerStore.resetPlacingRuler(rulerId.value);
      widget.value.resetInteractionState();
    });

    // --- placing ruler finalization --- //

    const getCurrentFrameOfReference = (): FrameOfReference => {
      const planeNormal = currentImageMetadata.value.lpsOrientation[
        viewDirection.value
      ] as Vector3;
      const planeOrigin = ruler.value!.firstPoint!;
      return {
        planeNormal,
        planeOrigin,
      };
    };

    // this only happens for the placing ruler
    const onFinalizedEvent = useVTKCallback(
      computed(() => widget.value?.onFinalizedEvent)
    );

    onFinalizedEvent(() => {
      if (!currentImageID.value || !isPlacingRuler.value || !widget.value) {
        return;
      }
      // set name + imageID + frame + slice
      rulerStore.updateRuler(rulerId.value, {
        name: 'Ruler',
        imageID: currentImageID.value,
        slice: currentSlice.value,
        frameOfReference: getCurrentFrameOfReference(),
      });

      // resets the widget and the backing placing ruler
      rulerStore.commitPlacingRuler(rulerId.value);
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
        ruler.value?.slice ?? currentSlice.value,
        currentImageMetadata.value
      );
    });

    // --- visibility --- //

    // technically toggles the pickability of the ruler
    // handles, since the 3D ruler parts are visually hidden.
    watch(
      () => ruler.value?.slice === currentSlice.value,
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
