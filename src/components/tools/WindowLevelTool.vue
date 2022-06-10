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
import { Tools, useToolStore } from '@/src/store/tools';
import {
  useView2DConfigStore,
  defaultWindowLevelConfig,
} from '@/src/store/view-2D-configs';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import vtkMouseRangeManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseRangeManipulator';
import { CreateElement, RenderContext } from 'vue';

function computeStep(min: number, max: number) {
  return Math.min(max - min, 1) / 256;
}

const PROPS = {
  viewId: {
    type: String,
    required: true,
  },
  viewProxy: {
    type: Object as PropType<vtkLPSView2DProxy>,
    required: true,
  },
} as const;

const WindowLevelTool = defineComponent({
  name: 'WindowLevelTool',
  props: PROPS,
  setup(props) {
    const { viewId: viewID, viewProxy } = toRefs(props);
    const view2DConfigStore = useView2DConfigStore();
    const { currentImageID } = useCurrentImage();

    const windowConfigDefaults = defaultWindowLevelConfig();
    const wlConfig = computed(() =>
      currentImageID.value !== null
        ? view2DConfigStore.getWindowConfig(viewID.value, currentImageID.value)
        : null
    );

    const wwRange = computed(() => ({
      min: 0,
      max:
        wlConfig.value !== null
          ? wlConfig.value.max - wlConfig.value.min
          : windowConfigDefaults.max,
      step:
        wlConfig.value !== null
          ? computeStep(wlConfig.value.min, wlConfig.value.max)
          : computeStep(windowConfigDefaults.min, windowConfigDefaults.max),
      default:
        wlConfig.value !== null
          ? wlConfig.value.width
          : windowConfigDefaults.width,
    }));
    const wlRange = computed(() => ({
      min:
        wlConfig.value !== null ? wlConfig.value.min : windowConfigDefaults.min,
      max:
        wlConfig.value !== null ? wlConfig.value.max : windowConfigDefaults.max,
      step:
        wlConfig.value !== null
          ? computeStep(wlConfig.value.min, wlConfig.value.max)
          : computeStep(windowConfigDefaults.min, windowConfigDefaults.max),
      default:
        wlConfig.value !== null
          ? wlConfig.value.level
          : windowConfigDefaults.level,
    }));

    const vertVal = ref(0);
    const horizVal = ref(0);

    watch(vertVal, (ww) => {
      if (currentImageID.value !== null) {
        view2DConfigStore.setWindowLevel(viewID.value, currentImageID.value, {
          width: ww,
        });
      }
    });
    watch(horizVal, (wl) => {
      if (currentImageID.value !== null) {
        view2DConfigStore.setWindowLevel(viewID.value, currentImageID.value, {
          level: wl,
        });
      }
    });

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

export default {
  functional: true,
  render(h: CreateElement, ctx: RenderContext<typeof PROPS>) {
    const toolStore = useToolStore();
    const active = computed(() => toolStore.currentTool === Tools.WindowLevel);
    // TODO vue 3 does away with VNodeData, so
    // remove the props key
    return active.value ? h(WindowLevelTool, { props: ctx.props }) : [];
  },
};

// export default defineComponent({
//     name: 'WindowLevelToolContainer',
//   props: PROPS,
//   setup(props) {
//     const toolStore = useToolStore();
//     const active = computed(() => toolStore.currentTool === Tools.WindowLevel);
//     return () =>
//       active.value
//         ? h(WindowLevelTool, {
//             // TODO vue 3 does away with VNodeData, so
//             // remove the props key
//             props,
//           })
//         : null;
//   },
// });
</script>
