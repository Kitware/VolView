<script lang="ts">
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import {
  defineComponent,
  onBeforeUnmount,
  onMounted,
  PropType,
  ref,
  toRefs,
  watchEffect,
} from '@vue/composition-api';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { LPSAxisDir } from '@/src/types/lps';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { updatePlaneManipulatorFor2DView } from '@/src/utils/manipulators';
import { vtkCrosshairsViewWidget } from '@/src/vtk/CrosshairsWidget';
import { useCrosshairsToolStore } from '@/src/store/tools/crosshairs';

export default defineComponent({
  name: 'CrosshairsWidget2D',
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
    } = toRefs(props);

    const crosshairsStore = useCrosshairsToolStore();
    const factory = crosshairsStore.getWidgetFactory();

    const widgetRef = ref<vtkCrosshairsViewWidget>();

    const { currentImageMetadata } = useCurrentImage();
    onMounted(() => {
      const widgetManager = widgetManagerRef.value;
      widgetRef.value = widgetManager.addWidget(
        factory
      ) as vtkCrosshairsViewWidget;

      if (!widgetRef.value) {
        throw new Error('[PaintWidget2D] failed to create view widget');
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
      widgetRef.value!.setVisibility(true);
    });

    // --- focus and rendering --- //

    onMounted(() => {
      const widgetManager = widgetManagerRef.value;
      widgetManager.renderWidgets();
    });

    onBeforeUnmount(() => {
      widgetManagerRef.value.removeWidget(widgetRef.value!);
    });

    return () => null;
  },
});
</script>
