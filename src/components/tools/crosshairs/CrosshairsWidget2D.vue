<script lang="ts">
import {
  defineComponent,
  PropType,
  toRefs,
  watchEffect,
  computed,
  inject,
  onUnmounted,
  onMounted,
} from 'vue';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { LPSAxisDir } from '@/src/types/lps';
import { useImage } from '@/src/composables/useCurrentImage';
import { updatePlaneManipulatorFor2DView } from '@/src/utils/manipulators';
import { vtkCrosshairsViewWidget } from '@/src/vtk/CrosshairsWidget';
import { useCrosshairsToolStore } from '@/src/store/tools/crosshairs';
import { Maybe } from '@/src/types';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useSliceInfo } from '@/src/composables/useSliceInfo';

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
    imageId: String as PropType<Maybe<string>>,
  },
  setup(props) {
    const { viewDirection, imageId, viewId } = toRefs(props);

    const view = inject(VtkViewContext);
    if (!view) throw new Error('No VtkView');

    const sliceInfo = useSliceInfo(viewId, imageId);
    const slice = computed(() => {
      return sliceInfo.value?.slice;
    });

    const crosshairsStore = useCrosshairsToolStore();
    const factory = crosshairsStore.getWidgetFactory();
    const widget = view.widgetManager.addWidget(
      factory
    ) as vtkCrosshairsViewWidget;

    onUnmounted(() => {
      view.widgetManager.removeWidget(factory);
    });

    // --- manipulator --- //

    const manipulator = vtkPlaneManipulator.newInstance();
    widget.setManipulator(manipulator);

    const { metadata: imageMetadata } = useImage(imageId);
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

    widget.setVisibility(true);

    // --- focus and rendering --- //

    onMounted(() => {
      view.widgetManager.renderWidgets();
    });

    return () => null;
  },
});
</script>
