<script lang="ts">
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
import { vtkLPSViewProxy } from '@/src/types/vtk-types';

export default defineComponent({
  name: 'CrosshairsWidget2D',
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

    const widgetRef = ref<vtkCrosshairsViewWidget>();

    const crosshairsStore = useCrosshairsToolStore();
    const factory = crosshairsStore.getWidgetFactory();
    const viewProxy = computed(() =>
      useViewStore().getViewProxy<vtkLPSViewProxy>(viewId.value)
    );
    const widgetManagerRef = computed(() =>
      viewProxy.value?.getWidgetManager()
    );

    onViewProxyMounted(viewProxy, () => {
      const widgetManager = widgetManagerRef.value;
      widgetRef.value = widgetManager?.addWidget(
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
      widgetManager?.renderWidgets();
    });

    onBeforeUnmount(() => {
      widgetManagerRef.value?.removeWidget(widgetRef.value!);
    });

    return () => null;
  },
});
</script>
