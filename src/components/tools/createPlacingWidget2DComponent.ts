import { WidgetComponentMeta } from '@/src/components/tools/common';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useViewWidget } from '@/src/composables/useViewWidget';
import { AnnotationToolStore } from '@/src/store/tools/useAnnotationTool';
import { Maybe } from '@/src/types';
import { LPSAxisDir } from '@/src/types/lps';
import { updatePlaneManipulatorFor2DView } from '@/src/utils/manipulators';
import { vtkAnnotationToolWidget } from '@/src/vtk/ToolWidgetUtils/utils';
import vtkAbstractWidgetFactory from '@kitware/vtk.js/Widgets/Core/AbstractWidgetFactory';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import {
  PropType,
  Ref,
  defineComponent,
  onMounted,
  onUnmounted,
  toRefs,
  watch,
  watchEffect,
} from 'vue';

export function createPlacingWidget2DComponent<
  ToolID extends string,
  ToolStore extends AnnotationToolStore<ToolID>,
  WidgetState extends vtkWidgetState,
  WidgetFactory extends vtkAbstractWidgetFactory,
  ViewWidget extends vtkAnnotationToolWidget,
  SyncedState,
  InitState
>(
  meta: WidgetComponentMeta<
    ToolID,
    ToolStore,
    WidgetState,
    WidgetFactory,
    ViewWidget,
    SyncedState,
    InitState
  >
) {
  type LabelProps = ToolStore['labels'][string];
  return defineComponent({
    name: meta.name,
    emits: ['placed'],
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
      currentSlice: {
        type: Number,
        required: true,
      },
      labelProps: {
        type: Object as PropType<LabelProps>,
        required: false,
      },
    },
    setup(props, { emit }) {
      const { viewId, labelProps, widgetManager, viewDirection, currentSlice } =
        toRefs(props);

      const { currentImageID, currentImageMetadata } = useCurrentImage();

      const widgetState = meta.createStandaloneState();
      const widgetFactory = meta.createWidgetFactory(widgetState);

      const syncedState = meta.useSyncedState(widgetFactory);
      const widget = useViewWidget<ViewWidget>(widgetFactory, widgetManager);

      onMounted(() => {
        meta.resetPlacingWidget(widget.value!);
      });

      onUnmounted(() => {
        widgetFactory.delete();
      });

      // --- reset on slice/image changes --- //

      watch([currentSlice, currentImageID, widget], () => {
        if (widget.value) {
          meta.resetPlacingWidget(widget.value);
        }
      });

      // --- placed event --- //

      onVTKEvent(
        widget as Ref<Maybe<vtkAnnotationToolWidget>>,
        'onPlacedEvent',
        () => {
          const initState = meta.constructInitState(syncedState);
          emit('placed', initState);
          meta.resetPlacingWidget(widget.value!);
        }
      );

      // --- manipulator --- //

      const manipulator = vtkPlaneManipulator.newInstance();

      onMounted(() => {
        widget.value?.setManipulator(manipulator);
      });

      watchEffect(() => {
        updatePlaneManipulatorFor2DView(
          manipulator,
          viewDirection.value,
          currentSlice.value,
          currentImageMetadata.value
        );
      });

      // --- visibility --- //

      onMounted(() => {
        if (!widget.value) {
          return;
        }
        // hide handle visibility, but not picking visibility
        widget.value.setHandleVisibility(false);
        widgetManager.value.renderWidgets();
      });

      // --- //

      return () => meta.render?.(viewId.value, syncedState, labelProps.value);
    },
  });
}
