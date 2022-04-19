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
import { useView2DStore } from '@/src/store/views-2D';

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
    const view2DStore = useView2DStore();

    const sliceConfig = computed(() => view2DStore.sliceConfigs[viewID.value]);
    const sliceRange = computed(() => ({
      min: sliceConfig.value.min,
      max: sliceConfig.value.max,
      step: 1,
      default: sliceConfig.value.slice,
    }));

    const scrollVal = ref(0);

    watch(scrollVal, (slice) => {
      view2DStore.setSlice(viewID.value, slice);
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
