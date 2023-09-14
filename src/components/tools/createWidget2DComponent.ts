import { WidgetComponentMeta } from '@/src/components/tools/common';
import { useRightClickContextMenu } from '@/src/composables/annotationTool';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useViewWidget } from '@/src/composables/useViewWidget';
import { AnnotationToolStore } from '@/src/store/tools/useAnnotationTool';
import { useViewStore } from '@/src/store/views';
import { LPSAxisDir } from '@/src/types/lps';
import { updatePlaneManipulatorFor2DView } from '@/src/utils/manipulators';
import { vtkAnnotationToolWidget } from '@/src/vtk/ToolWidgetUtils/utils';
import vtkAbstractWidgetFactory from '@kitware/vtk.js/Widgets/Core/AbstractWidgetFactory';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import {
  PropType,
  computed,
  defineComponent,
  onMounted,
  onUnmounted,
  toRefs,
  watch,
  watchEffect,
} from 'vue';

export function createWidget2DComponent<
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
  return defineComponent({
    name: meta.name,
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
    setup(props, { emit }) {
      const { toolId, viewId, widgetManager, viewDirection, currentSlice } =
        toRefs(props);

      const toolStore = meta.useToolStore();
      const tool = computed(() => toolStore.toolByID[toolId.value as ToolID]);
      const viewProxy = computed(() =>
        useViewStore().getViewProxy(viewId.value)
      );

      const widgetState = meta.createStoreBackedState(toolId.value, toolStore);
      const widgetFactory = meta.createWidgetFactory(widgetState);

      const syncedState = meta.useSyncedState(widgetFactory);
      const widget = useViewWidget<ViewWidget>(widgetFactory, widgetManager);

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

      // toggles the pickability of the ruler handles,
      // since the 3D ruler parts are visually hidden.
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

      type LabelProps = ToolStore['labels'][string];
      const labelProps = computed(() =>
        tool.value.label
          ? (toolStore.labels[tool.value.label] as LabelProps)
          : null
      );

      return () => meta.render?.(viewId.value, syncedState, labelProps.value);
    },
  });
}
