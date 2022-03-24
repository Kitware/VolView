<script lang="ts">
import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  PropType,
  ref,
  toRefs,
  watch,
} from '@vue/composition-api';
import vtkLPSView2DProxy from '@/src/vtk/LPSView2DProxy';
import { Tools, useToolStore } from '@/src/store/tools';
import { useView2DStore } from '@/src/storex/views-2D';
import vtkMouseRangeManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseRangeManipulator';

function computeStep(min: number, max: number) {
  return Math.min(max - min, 1) / 256;
}

const WindowLevelTool = defineComponent({
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

    const wlConfig = computed(() => view2DStore.wlConfigs[viewID.value]);

    const wwRange = computed(() => ({
      min: 0,
      max: wlConfig.value.max - wlConfig.value.min,
      step: computeStep(wlConfig.value.min, wlConfig.value.max),
      default: wlConfig.value.width,
    }));
    const wlRange = computed(() => ({
      min: wlConfig.value.min,
      max: wlConfig.value.max,
      step: computeStep(wlConfig.value.min, wlConfig.value.max),
      default: wlConfig.value.level,
    }));

    const vertVal = ref(0);
    const horizVal = ref(0);

    watch(vertVal, (ww) =>
      view2DStore.setWindowLevel(viewID.value, { width: ww })
    );
    watch(horizVal, (wl) =>
      view2DStore.setWindowLevel(viewID.value, { level: wl })
    );

    const rangeManipulator = vtkMouseRangeManipulator.newInstance({
      button: 1,
      scrollEnabled: false,
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
      const vertRange = wwRange.value;
      const horizRange = wlRange.value;

      rangeManipulator.setVerticalListener(
        vertRange.min,
        vertRange.max,
        vertRange.step,
        () => vertVal.value,
        (v) => {
          vertVal.value = v;
        }
      );

      rangeManipulator.setHorizontalListener(
        horizRange.min,
        horizRange.max,
        horizRange.step,
        () => horizVal.value,
        (v) => {
          horizVal.value = v;
        }
      );
    }

    watch(
      () => [wwRange.value, wlRange.value],
      ([ww, wl]) => {
        vertVal.value = ww.default;
        horizVal.value = wl.default;
        updateManipulator();
      },
      { immediate: true }
    );

    return () => null;
  },
});

export default defineComponent({
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
    const toolStore = useToolStore();
    const active = computed(() => toolStore.currentTool === Tools.WindowLevel);
    return () =>
      active.value
        ? h(WindowLevelTool, {
            // TODO vue 3 does away with VNodeData, so
            // remove the props key
            props,
          })
        : null;
  },
});
</script>
