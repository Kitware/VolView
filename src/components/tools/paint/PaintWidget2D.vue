<script lang="ts">
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
  watchEffect,
} from 'vue';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { updatePlaneManipulatorFor2DView } from '@/src/utils/manipulators';
import { vtkSubscription } from '@kitware/vtk.js/interfaces';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { vtkPaintViewWidget } from '@/src/vtk/PaintWidget';
import { useViewStore } from '@/src/store/views';
import { PaintWidgetState } from '@/src/vtk/PaintWidget/state';
import { vec3 } from 'gl-matrix';
import { manageVTKSubscription } from '@/src/composables/manageVTKSubscription';
import { LPSAxisDir } from '@/src/types/lps';

export default defineComponent({
  name: 'PaintWidget2D',
  props: {
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
    slice: {
      type: Number,
      required: true,
    },
  },
  setup(props) {
    const {
      widgetManager: widgetManagerRef,
      viewDirection,
      slice,
      viewId: viewID,
    } = toRefs(props);

    const paintStore = usePaintToolStore();
    const factory = paintStore.getWidgetFactory();

    const viewStore = useViewStore();
    const viewProxyRef = computed(() => viewStore.getViewProxy(viewID.value));

    const widgetRef = ref<vtkPaintViewWidget>();

    const { currentImageMetadata } = useCurrentImage();
    const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));
    const viewAxisIndex = computed(
      () => currentImageMetadata.value.lpsOrientation[viewAxis.value]
    );

    const worldPointToIndex = (worldPoint: vec3) => {
      const { worldToIndex } = currentImageMetadata.value;
      const indexPoint = vec3.create();
      vec3.transformMat4(indexPoint, worldPoint, worldToIndex);
      return indexPoint;
    };

    onMounted(() => {
      const widgetManager = widgetManagerRef.value;
      widgetRef.value = widgetManager.addWidget(factory) as vtkPaintViewWidget;

      if (!widgetRef.value) {
        throw new Error('[PaintWidget2D] failed to create view widget');
      }
    });

    // --- widget representation config --- //

    watchEffect(() => {
      const widget = widgetRef.value!;
      const metadata = currentImageMetadata.value;
      const slicingIndex = metadata.lpsOrientation[viewAxis.value];
      if (widget) {
        widget.setSlicingIndex(slicingIndex);
        widget.setIndexToWorld(metadata.indexToWorld);
        widget.setWorldToIndex(metadata.worldToIndex);
      }
    });

    // --- interaction --- //

    const subs: vtkSubscription[] = [];

    onMounted(() => {
      const widget = widgetRef.value!;

      subs.push(
        widget.onStartInteractionEvent(() => {
          // start stroke
          const state = widget.getWidgetState() as PaintWidgetState;
          // StartInteraction cannot occur if origin is null.
          const indexPoint = worldPointToIndex(state.getBrush().getOrigin()!);
          paintStore.startStroke(indexPoint, viewAxisIndex.value);
        }),
        widget.onInteractionEvent(() => {
          // register stroke
          const state = widget.getWidgetState() as PaintWidgetState;
          const indexPoint = worldPointToIndex(state.getBrush().getOrigin()!);
          paintStore.placeStrokePoint(indexPoint, viewAxisIndex.value);
        }),
        widget.onEndInteractionEvent(() => {
          // end stroke
          const state = widget.getWidgetState() as PaintWidgetState;
          const indexPoint = worldPointToIndex(state.getBrush().getOrigin()!);
          paintStore.endStroke(indexPoint, viewAxisIndex.value);
        })
      );
    });

    onUnmounted(() => {
      while (subs.length) {
        subs.pop()!.unsubscribe();
      }
    });

    // --- manipulator --- //

    const manipulator = vtkPlaneManipulator.newInstance();

    onMounted(() => {
      widgetRef.value!.setManipulator(manipulator);
    });

    watchEffect(() => {
      updatePlaneManipulatorFor2DView(
        manipulator,
        viewDirection.value,
        slice.value,
        currentImageMetadata.value
      );
    });

    // --- visibility --- //

    onMounted(() => {
      widgetRef.value!.setVisibility(false);
    });

    manageVTKSubscription(
      viewProxyRef.value!.getInteractor().onMouseEnter(() => {
        const widget = widgetRef.value;
        if (widget) {
          paintStore.setSliceAxis(viewAxisIndex.value);
          widget.setVisibility(true);
        }
      })
    );

    manageVTKSubscription(
      viewProxyRef.value!.getInteractor().onMouseLeave(() => {
        const widget = widgetRef.value;
        if (widget) {
          widget.setVisibility(false);
        }
      })
    );

    // --- focus and rendering --- //

    onMounted(() => {
      const widgetManager = widgetManagerRef.value;
      widgetManager.renderWidgets();
      widgetManager.grabFocus(widgetRef.value!);
    });

    onBeforeUnmount(() => {
      widgetManagerRef.value.removeWidget(widgetRef.value!);
      widgetManagerRef.value.releaseFocus();
    });

    return () => null;
  },
});
</script>
