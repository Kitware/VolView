<script lang="ts">
import {
  computed,
  defineComponent,
  PropType,
  ref,
  toRefs,
  watchEffect,
} from 'vue';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { updatePlaneManipulatorFor2DView } from '@/src/utils/manipulators';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { vtkPaintViewWidget } from '@/src/vtk/PaintWidget';
import { useViewStore } from '@/src/store/views';
import { PaintWidgetState } from '@/src/vtk/PaintWidget/state';
import { vec3 } from 'gl-matrix';
import { LPSAxisDir } from '@/src/types/lps';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import {
  onViewProxyMounted,
  onViewProxyUnmounted,
} from '@/src/composables/useViewProxy';
import { vtkLPSViewProxy } from '@/src/types/vtk-types';

export default defineComponent({
  name: 'PaintWidget2D',
  props: {
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
    const { viewDirection, slice, viewId } = toRefs(props);

    const paintStore = usePaintToolStore();
    const widgetFactory = paintStore.getWidgetFactory();

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

    const viewProxy = computed(() =>
      useViewStore().getViewProxy<vtkLPSViewProxy>(viewId.value)
    );
    const widgetManager = computed(() => viewProxy.value?.getWidgetManager());

    onViewProxyMounted(viewProxy, () => {
      widgetRef.value = widgetManager.value?.addWidget(
        widgetFactory
      ) as vtkPaintViewWidget;

      if (!widgetRef.value) {
        throw new Error('PaintWidget2D failed to create view widget');
      }

      widgetManager.value?.renderWidgets();
      widgetManager.value?.grabFocus(widgetRef.value);
    });

    onViewProxyUnmounted(viewProxy, () => {
      if (!widgetRef.value) {
        return;
      }
      widgetManager.value?.removeWidget(widgetRef.value);
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

    onVTKEvent(widgetRef, 'onStartInteractionEvent', () => {
      const state = widgetRef.value!.getWidgetState() as PaintWidgetState;
      // StartInteraction cannot occur if origin is null.
      const indexPoint = worldPointToIndex(state.getBrush().getOrigin()!);
      paintStore.startStroke(indexPoint, viewAxisIndex.value);
    });

    onVTKEvent(widgetRef, 'onInteractionEvent', () => {
      const state = widgetRef.value!.getWidgetState() as PaintWidgetState;
      const indexPoint = worldPointToIndex(state.getBrush().getOrigin()!);
      paintStore.placeStrokePoint(indexPoint, viewAxisIndex.value);
    });

    onVTKEvent(widgetRef, 'onEndInteractionEvent', () => {
      // end stroke
      const state = widgetRef.value!.getWidgetState() as PaintWidgetState;
      const indexPoint = worldPointToIndex(state.getBrush().getOrigin()!);
      paintStore.endStroke(indexPoint, viewAxisIndex.value);
    });

    // --- manipulator --- //

    const manipulator = vtkPlaneManipulator.newInstance();

    onViewProxyMounted(viewProxy, () => {
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

    let checkIfPointerInView = false;

    onViewProxyMounted(viewProxy, () => {
      widgetRef.value!.setVisibility(false);
      checkIfPointerInView = true;
    });

    const viewInteractor = computed(() => viewProxy.value!.getInteractor());

    // Turn on widget visibility and update stencil
    // if mouse starts within view
    onVTKEvent(viewInteractor, 'onMouseMove', () => {
      if (!checkIfPointerInView) {
        return;
      }
      checkIfPointerInView = false;

      widgetRef.value!.setVisibility(true);
      paintStore.setSliceAxis(viewAxisIndex.value);
    });

    onVTKEvent(viewInteractor, 'onMouseEnter', () => {
      const widget = widgetRef.value;
      if (widget) {
        paintStore.setSliceAxis(viewAxisIndex.value);
        widget.setVisibility(true);
      }
    });

    onVTKEvent(viewInteractor, 'onMouseLeave', () => {
      const widget = widgetRef.value;
      if (widget) {
        widget.setVisibility(false);
      }
    });

    return () => null;
  },
});
</script>
