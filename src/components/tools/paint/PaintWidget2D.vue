<script lang="ts">
import {
  computed,
  onMounted,
  onUnmounted,
  defineComponent,
  PropType,
  toRefs,
  watchEffect,
  inject,
} from 'vue';
import { useMagicKeys } from '@vueuse/core';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { vec3 } from 'gl-matrix';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import { useImage } from '@/src/composables/useCurrentImage';
import { updatePlaneManipulatorFor2DView } from '@/src/utils/manipulators';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { vtkPaintViewWidget } from '@/src/vtk/PaintWidget';
import { LPSAxisDir } from '@/src/types/lps';
import { getLPSDirections } from '@/src/utils/lps';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { useSliceInfo } from '@/src/composables/useSliceInfo';
import { VtkViewContext } from '@/src/components/vtk/context';
import { Maybe } from '@/src/types';
import { PaintMode } from '@/src/core/tools/paint';
import { actionToKey } from '@/src/composables/useKeyboardShortcuts';

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
    imageId: String as PropType<Maybe<string>>,
  },
  setup(props) {
    const { viewDirection, viewId, imageId } = toRefs(props);

    const view = inject(VtkViewContext);
    if (!view) throw new Error('No VtkView');

    const sliceInfo = useSliceInfo(viewId, imageId);
    const slice = computed(() => sliceInfo.value?.slice);

    const paintStore = usePaintToolStore();
    const segmentGroupStore = useSegmentGroupStore();
    const widgetFactory = paintStore.getWidgetFactory();
    const widgetState = widgetFactory.getWidgetState();

    const { metadata: imageMetadata } = useImage(imageId);
    const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));
    const viewAxisIndex = computed(
      () => imageMetadata.value.lpsOrientation[viewAxis.value]
    );

    // Get the active labelmap for coordinate transforms
    const activeLabelmap = computed(() => {
      const groupId = paintStore.activeSegmentGroupID;
      if (!groupId) return null;
      return segmentGroupStore.dataIndex[groupId] ?? null;
    });

    const widget = view.widgetManager.addWidget(
      widgetFactory
    ) as vtkPaintViewWidget;

    // --- widget representation config --- //

    watchEffect(() => {
      if (!widget) return;

      const labelmap = activeLabelmap.value;
      if (labelmap) {
        // Use labelmap's transforms so brush preview matches where paint appears
        const labelmapLps = getLPSDirections(labelmap.getDirection());
        const slicingIndex = labelmapLps[viewAxis.value];
        widget.setSlicingIndex(slicingIndex);
        widget.setIndexToWorld(labelmap.getIndexToWorld());
        widget.setWorldToIndex(labelmap.getWorldToIndex());
      } else {
        // Fall back to parent image transforms
        const metadata = imageMetadata.value;
        const slicingIndex = metadata.lpsOrientation[viewAxis.value];
        widget.setSlicingIndex(slicingIndex);
        widget.setIndexToWorld(metadata.indexToWorld);
        widget.setWorldToIndex(metadata.worldToIndex);
      }
    });

    // --- interaction --- //

    onVTKEvent(widget, 'onStartInteractionEvent', () => {
      if (!imageId.value) return;
      paintStore.setSliceAxis(viewAxisIndex.value, imageId.value);
      const origin = widgetState.getBrush().getOrigin()!;
      paintStore.startStroke(
        vec3.clone(origin),
        viewAxisIndex.value,
        imageId.value
      );
      paintStore.updatePaintPosition(origin, viewId.value);
    });

    onVTKEvent(widget, 'onInteractionEvent', () => {
      if (!imageId.value) return;
      const origin = widgetState.getBrush().getOrigin()!;
      paintStore.placeStrokePoint(
        vec3.clone(origin),
        viewAxisIndex.value,
        imageId.value
      );
      paintStore.updatePaintPosition(origin, viewId.value);
    });

    onVTKEvent(widget, 'onEndInteractionEvent', () => {
      if (!imageId.value) return;
      paintStore.endStroke(
        vec3.clone(widgetState.getBrush().getOrigin()!),
        viewAxisIndex.value,
        imageId.value
      );
    });

    // --- manipulator --- //

    const manipulator = vtkPlaneManipulator.newInstance();
    widget.setManipulator(manipulator);

    watchEffect(() => {
      if (slice.value == null) return;
      updatePlaneManipulatorFor2DView(
        manipulator,
        viewDirection.value,
        slice.value,
        imageMetadata.value
      );
    });

    // --- visibility --- //

    let checkIfPointerInView = false;

    // Turn on widget visibility and update stencil if mouse starts within view
    onVTKEvent(view.interactor, 'onMouseMove', () => {
      if (!checkIfPointerInView) return;
      checkIfPointerInView = false;
      widget.setVisibility(true);
      if (imageId.value) {
        paintStore.setSliceAxis(viewAxisIndex.value, imageId.value);
      }
    });

    onVTKEvent(view.interactor, 'onMouseEnter', () => {
      if (imageId.value) {
        paintStore.setSliceAxis(viewAxisIndex.value, imageId.value);
      }
      widget.setVisibility(true);
    });

    onVTKEvent(view.interactor, 'onMouseLeave', () => {
      widget.setVisibility(false);
    });

    watchEffect(() => {
      widget.setEnabled(paintStore.activeMode !== PaintMode.Process);
    });

    // Brush size scroll wheel control with customizable modifier key
    const keys = useMagicKeys();
    const enableBrushSizeAdjustment = computed(
      () => keys[actionToKey.value.brushSizeModifier].value
    );

    const handleWheelEvent = (event: WheelEvent) => {
      if (!enableBrushSizeAdjustment.value) return;
      event.preventDefault();
      const delta = event.deltaY < 0 ? 1 : -1;
      const newSize = Math.max(1, Math.min(50, paintStore.brushSize + delta));
      paintStore.setBrushSize(newSize);
    };

    onMounted(() => {
      view.widgetManager.renderWidgets();
      view.widgetManager.grabFocus(widget);
      widget.setVisibility(false);
      checkIfPointerInView = true;
      view.renderWindowView
        .getContainer()
        ?.addEventListener('wheel', handleWheelEvent, { passive: false });
    });

    onUnmounted(() => {
      view.widgetManager.removeWidget(widgetFactory);
      view.renderWindowView
        .getContainer()
        ?.removeEventListener('wheel', handleWheelEvent);
    });

    return () => null;
  },
});
</script>
