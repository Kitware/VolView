<script lang="ts">
import {
  computed,
  defineComponent,
  onBeforeUnmount,
  onMounted,
  PropType,
  ref,
  toRefs,
  watch,
} from '@vue/composition-api';
import vtkLPSView2DProxy from '@/src/vtk/LPSView2DProxy';
import vtkMouseRangeManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseRangeManipulator';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import {
  useViewConfigStore,
  defaultSliceConfig,
} from '@/src/store/view-configs';

export default defineComponent({
  name: 'SliceScrollTool',
  props: {
    viewId: {
      type: String,
      required: true,
    },
    viewProxy: {
      type: Object as PropType<vtkLPSView2DProxy>,
      required: true,
    },
  },
  setup(props) {
    const { viewId: viewID, viewProxy } = toRefs(props);
    const viewConfigStore = useViewConfigStore();
    const { currentImageID } = useCurrentImage();

    const sliceConfigDefault = defaultSliceConfig();
    const sliceConfig = computed(() =>
      currentImageID.value !== null
        ? viewConfigStore.getSliceConfig(viewID.value, currentImageID.value)
        : null
    );
    const sliceRange = computed(() => ({
      min:
        sliceConfig.value !== null
          ? sliceConfig.value.min
          : sliceConfigDefault.min,
      max:
        sliceConfig.value !== null
          ? sliceConfig.value.max
          : sliceConfigDefault.max,
      step: 1,
      default:
        sliceConfig.value !== null
          ? sliceConfig.value.slice
          : sliceConfigDefault.slice,
    }));

    const scrollVal = ref(0);

    watch(scrollVal, (slice) => {
      if (currentImageID.value !== null) {
        viewConfigStore.setSlice(viewID.value, currentImageID.value, slice);
      }
    });

    const rangeManipulator = vtkMouseRangeManipulator.newInstance({
      button: -1, // don't bind to any buttons
      scrollEnabled: true,
    });

    onMounted(() => {
      // assumed to be vtkInteractorStyleManipulator
      const istyle = viewProxy.value.getInteractorStyle2D();
      istyle.addMouseManipulator(rangeManipulator);
    });

    onBeforeUnmount(() => {
      // for some reason, VtkTwoView.onBeforeUnmount is being
      // invoked before this onBeforeUnmount during HMR.
      if (!viewProxy.value.isDeleted()) {
        const istyle = viewProxy.value.getInteractorStyle2D();
        istyle.removeMouseManipulator(rangeManipulator);
      }
    });

    function updateManipulator() {
      rangeManipulator.removeAllListeners();
      const range = sliceRange.value;

      rangeManipulator.setScrollListener(
        range.min,
        range.max,
        range.step,
        () => scrollVal.value,
        (v) => {
          scrollVal.value = v;
        }
      );
    }

    watch(
      sliceRange,
      (range) => {
        scrollVal.value = range.default;
        updateManipulator();
      },
      { immediate: true }
    );

    return () => null;
  },
});
</script>
