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
  ref,
} from 'vue';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { vec3 } from 'gl-matrix';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import { useImage } from '@/src/composables/useCurrentImage';
import { updatePlaneManipulatorFor2DView } from '@/src/utils/manipulators';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { vtkPaintViewWidget } from '@/src/vtk/PaintWidget';
import { LPSAxisDir } from '@/src/types/lps';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { useSliceInfo } from '@/src/composables/useSliceInfo';
import { VtkViewContext } from '@/src/components/vtk/context';
import { Maybe } from '@/src/types';
import { PaintMode } from '@/src/core/tools/paint';
import { usePaintInteractionMode } from '@/src/segmentation/composables/usePaintInteractionMode';
import eyedropperCursor from '@/src/assets/eyedropper-cursor.svg?url';
import { useActionHeld } from '@/src/composables/useKeyboardShortcuts';

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
    const interactionMode = usePaintInteractionMode();
    const sampling = computed(
      () => interactionMode.value === PaintMode.Eyedropper
    );
    const widgetFactory = paintStore.getWidgetFactory();
    const widgetState = widgetFactory.getWidgetState();

    const { metadata: imageMetadata } = useImage(imageId);
    const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));
    const viewAxisIndex = computed(
      () => imageMetadata.value.lpsOrientation[viewAxis.value]
    );

    const widget = view.widgetManager.addWidget(
      widgetFactory
    ) as vtkPaintViewWidget;
    widget.setPickable(false);

    // --- widget representation config --- //

    // Every mask uses the parent voxel grid. Selection and mask growth do not
    // change the brush's world-space footprint.
    watchEffect(() => {
      const metadata = imageMetadata.value;
      widget.setSlicingIndex(metadata.lpsOrientation[viewAxis.value]);
      widget.setIndexToWorld(metadata.indexToWorld);
      widget.setWorldToIndex(metadata.worldToIndex);
    });

    // Brush movement changes shared state, but only the view displaying the
    // preview needs to redraw. Mask edits request renders independently.
    onVTKEvent(widgetState, 'onModified', () => {
      if (widget.getVisibility()) view.requestRender();
    });
    onVTKEvent(widget, 'onModified', () => view.requestRender());

    // --- interaction --- //

    onVTKEvent(widget, 'onStartInteractionEvent', (event) => {
      if (!imageId.value) return;
      const origin = widgetState.getBrush().getOrigin()!;
      if (event?.sampling) {
        paintStore.selectSegmentAt(vec3.clone(origin), imageId.value);
        return;
      }
      paintStore.setSliceAxis(viewAxisIndex.value, imageId.value);
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
    const pointerInView = ref(false);
    const cursorStyles = view.widgetManager.getCursorStyles();
    watchEffect(() => {
      widget.setSampling(sampling.value);
      widget.setVisibility(pointerInView.value && !sampling.value);
      const cursor = sampling.value
        ? `url("${eyedropperCursor}") 2 22, crosshair`
        : cursorStyles.default;
      view.widgetManager.setCursorStyles(
        sampling.value
          ? { ...cursorStyles, default: cursor, hover: cursor }
          : cursorStyles
      );
      view.renderWindowView.set({ cursor });
    });

    // Turn on widget visibility and update stencil if mouse starts within view
    const showPreviewOnFirstMove = () => {
      if (!checkIfPointerInView) return;
      checkIfPointerInView = false;
      pointerInView.value = true;
      if (imageId.value) {
        paintStore.setSliceAxis(viewAxisIndex.value, imageId.value);
      }
    };
    onVTKEvent(view.interactor, 'onMouseMove', showPreviewOnFirstMove);

    onVTKEvent(view.interactor, 'onMouseEnter', () => {
      if (imageId.value) {
        paintStore.setSliceAxis(viewAxisIndex.value, imageId.value);
      }
      pointerInView.value = true;
    });

    onVTKEvent(view.interactor, 'onMouseLeave', () => {
      pointerInView.value = false;
    });

    watchEffect(() => {
      widget.setEnabled(paintStore.isPaintingModeActive);
    });

    // Brush size scroll wheel control with customizable modifier key
    const enableBrushSizeAdjustment = useActionHeld('brushSizeModifier');

    const handleWheelEvent = (event: WheelEvent) => {
      if (!enableBrushSizeAdjustment.value) return;
      event.preventDefault();
      const delta = event.deltaY < 0 ? 1 : -1;
      const newSize = Math.max(1, Math.min(50, paintStore.brushSize + delta));
      paintStore.setBrushSize(newSize);
    };

    onMounted(() => {
      view.widgetManager.grabFocus(widget);
      view.widgetManager.renderWidgets();
      widget.setVisibility(false);
      checkIfPointerInView = true;
      view.renderWindowView
        .getContainer()
        ?.addEventListener('wheel', handleWheelEvent, { passive: false });
    });

    onUnmounted(() => {
      view.widgetManager.setCursorStyles(cursorStyles);
      view.renderWindowView.set({ cursor: cursorStyles.default });
      view.widgetManager.removeWidget(widgetFactory);
      view.renderWindowView
        .getContainer()
        ?.removeEventListener('wheel', handleWheelEvent);
    });

    return () => null;
  },
});
</script>
