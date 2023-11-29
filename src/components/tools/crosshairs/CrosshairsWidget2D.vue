<script lang="ts">
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import {
  defineComponent,
  onBeforeUnmount,
  PropType,
  ref,
  toRefs,
  watchEffect,
  computed,
} from 'vue';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { LPSAxisDir } from '@/src/types/lps';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { updatePlaneManipulatorFor2DView } from '@/src/utils/manipulators';
import { vtkCrosshairsViewWidget } from '@/src/vtk/CrosshairsWidget';
import { useCrosshairsToolStore } from '@/src/store/tools/crosshairs';
import { useViewStore } from '@/src/store/views';
import { onViewProxyMounted } from '@/src/composables/useViewProxy';

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
      viewId,
    } = toRefs(props);

    const widgetRef = ref<vtkCrosshairsViewWidget>();

    const crosshairsStore = useCrosshairsToolStore();
    const factory = crosshairsStore.getWidgetFactory();
    const viewProxy = computed(() => useViewStore().getViewProxy(viewId.value));

    onViewProxyMounted(viewProxy, () => {
      const widgetManager = widgetManagerRef.value;
      widgetRef.value = widgetManager.addWidget(
        factory
      ) as vtkCrosshairsViewWidget;

      if (!widgetRef.value) {
        throw new Error('CrosshairsWidget2D failed to create view widget');
      }
    });

    // --- manipulator --- //

    const manipulator = vtkPlaneManipulator.newInstance();

    onViewProxyMounted(viewProxy, () => {
      widgetRef.value!.setManipulator(manipulator);
    });

    const { currentImageMetadata } = useCurrentImage();
    watchEffect(() => {
      updatePlaneManipulatorFor2DView(
        manipulator,
        viewDirection.value,
        slice.value,
        currentImageMetadata.value
      );
    });

    // --- visibility --- //

    onViewProxyMounted(viewProxy, () => {
      widgetRef.value!.setVisibility(true);
    });

    // --- focus and rendering --- //

    onViewProxyMounted(viewProxy, () => {
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
