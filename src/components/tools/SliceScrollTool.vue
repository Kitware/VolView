<script lang="ts">
import {
  computed,
  defineComponent,
  onBeforeUnmount,
  ref,
  toRefs,
  watch,
} from 'vue';
import vtkLPSView2DProxy from '@/src/vtk/LPSView2DProxy';
import vtkMouseRangeManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseRangeManipulator';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useViewStore } from '@/src/store/views';
import useViewSliceStore, {
  defaultSliceConfig,
} from '@/src/store/view-configs/slicing';

export default defineComponent({
  name: 'SliceScrollTool',
  props: {
    viewId: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    const { viewId: viewID } = toRefs(props);
    const viewSliceStore = useViewSliceStore();
    const viewStore = useViewStore();
    const { currentImageID } = useCurrentImage();

    const viewProxy = computed(
      () => viewStore.getViewProxy<vtkLPSView2DProxy>(viewID.value)!
    );

    const sliceConfigDefault = defaultSliceConfig();
    const sliceConfig = computed(() =>
      viewSliceStore.getConfig(viewID.value, currentImageID.value)
    );
    const sliceRange = computed(() => ({
      min:
        sliceConfig.value != null
          ? sliceConfig.value.min
          : sliceConfigDefault.min,
      max:
        sliceConfig.value != null
          ? sliceConfig.value.max
          : sliceConfigDefault.max,
      step: 1,
      default:
        sliceConfig.value != null
          ? sliceConfig.value.slice
          : sliceConfigDefault.slice,
    }));

    const scrollVal = ref(0);

    const rangeManipulator = vtkMouseRangeManipulator.newInstance({
      button: -1, // don't bind to any buttons
      scrollEnabled: true,
    });

    watch(
      viewProxy,
      (curViewProxy, oldViewProxy) => {
        if (oldViewProxy) {
          const istyle = oldViewProxy.getInteractorStyle2D();
          istyle.removeMouseManipulator(rangeManipulator);
        }

        if (curViewProxy) {
          // assumed to be vtkInteractorStyleManipulator
          const istyle = viewProxy.value.getInteractorStyle2D();
          istyle.addMouseManipulator(rangeManipulator);
        }
      },
      { immediate: true }
    );

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
        (slice) => {
          if (currentImageID.value !== null) {
            viewSliceStore.updateConfig(viewID.value, currentImageID.value, {
              slice,
            });
          }
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
