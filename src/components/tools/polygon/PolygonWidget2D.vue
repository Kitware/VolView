<script lang="ts">
import {
  reactive,
  computed,
  defineComponent,
  PropType,
  toRefs,
  watch,
  watchEffect,
  inject,
  onUnmounted,
  ref,
} from 'vue';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { useImage } from '@/src/composables/useCurrentImage';
import { updatePlaneManipulatorFor2DView } from '@/src/utils/manipulators';
import { LPSAxisDir } from '@/src/types/lps';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import {
  useRightClickContextMenu,
  useWidgetVisibility,
} from '@/src/composables/annotationTool';
import { getCSSCoordinatesFromEvent } from '@/src/utils/vtk-helpers';
import { usePolygonStore as useStore } from '@/src/store/tools/polygons';
import vtkWidgetFactory, {
  vtkPolygonViewWidget as WidgetView,
} from '@/src/vtk/PolygonWidget';
import { Maybe } from '@/src/types';
import type { Vector3 } from '@kitware/vtk.js/types';
import { ToolID } from '@/src/types/annotation-tool';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useSliceInfo } from '@/src/composables/useSliceInfo';
import SVG2DComponent from './PolygonSVG2D.vue';

export default defineComponent({
  name: 'PolygonWidget2D',
  emits: ['placed', 'contextmenu', 'widgetHover'],
  props: {
    toolId: {
      type: String as unknown as PropType<ToolID>,
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
    isPlacing: {
      type: Boolean,
      default: false,
    },
    imageId: String as PropType<Maybe<string>>,
  },
  components: {
    SVG2DComponent,
  },
  setup(props, { emit }) {
    const { toolId, viewId, viewDirection, imageId, isPlacing } = toRefs(props);

    const view = inject(VtkViewContext);
    if (!view) throw new Error('No VtkView');

    const sliceInfo = useSliceInfo(viewId, imageId);
    const slice = computed(() => sliceInfo.value?.slice);

    const toolStore = useStore();
    const tool = computed(() => toolStore.toolByID[toolId.value]);
    const { metadata: imageMetadata } = useImage(imageId);

    const widgetFactory = vtkWidgetFactory.newInstance({
      id: toolId.value,
    });
    const widget = view.widgetManager.addWidget(widgetFactory) as WidgetView;

    onUnmounted(() => {
      view.widgetManager.removeWidget(widget);
      widgetFactory.delete();
    });

    // --- reset on slice/image changes --- //

    watch([slice, imageId], () => {
      if (isPlacing.value) {
        widget.resetInteractions();
        widget.getWidgetState().clearHandles();
      }
    });

    onVTKEvent(widget, 'onPlacedEvent', () => {
      emit('placed');
    });

    const lastHoverEventData = ref<any>(null);
    onVTKEvent(widget, 'onHoverEvent', (eventData: any) => {
      lastHoverEventData.value = eventData;
    });
    const dragging = ref(false);
    onVTKEvent(widget, 'onDraggingEvent', (eventData: any) => {
      dragging.value = eventData.dragging;
    });
    const anotherToolPlacing = computed(() =>
      toolStore.tools.some(
        (t) => t.placing && t.id !== toolId.value && t.points.length > 0
      )
    );
    const showHandles = computed(() => {
      return (
        lastHoverEventData.value?.hovering &&
        !dragging.value &&
        !anotherToolPlacing.value
      );
    });
    watchEffect(() => {
      if (!lastHoverEventData.value) return;
      const displayXY = getCSSCoordinatesFromEvent(lastHoverEventData.value);
      if (displayXY) {
        emit('widgetHover', {
          displayXY,
          hovering: lastHoverEventData.value?.hovering && !dragging.value,
        });
      }
    });

    // --- right click handling --- //

    useRightClickContextMenu(emit, widget);

    // --- manipulator --- //

    const manipulator = vtkPlaneManipulator.newInstance();
    widget.setManipulator(manipulator);

    watchEffect(() => {
      updatePlaneManipulatorFor2DView(
        manipulator,
        viewDirection.value,
        tool.value?.slice ?? slice.value ?? 0,
        imageMetadata.value
      );
    });

    // --- visibility --- //

    const isVisible = computed(() => tool.value?.slice === slice.value);
    useWidgetVisibility(widget, isVisible, view);

    // --- //

    const editState = reactive({
      movePoint: null as Maybe<Vector3>,
      finishable: false,
    });

    const widgetState = widgetFactory.getWidgetState();
    onVTKEvent(widgetState, 'onModified', () => {
      editState.movePoint = widgetState.getMoveHandle().getOrigin();
      editState.finishable = widgetState.getFinishable();
    });

    return {
      slice,
      tool,
      editState,
      showHandles,
    };
  },
});
</script>

<template>
  <SVG2DComponent
    v-show="slice === tool.slice"
    :points="tool.points"
    :color="tool.color"
    :stroke-width="tool.strokeWidth"
    :move-point="editState.movePoint"
    :placing="tool.placing"
    :finishable="editState.finishable"
    :show-handles="showHandles"
  />
</template>
