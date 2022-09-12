<script lang="ts">
import {
  computed,
  defineComponent,
  onBeforeUnmount,
  onMounted,
  toRefs,
  watch,
} from '@vue/composition-api';
import { useViewStore } from '@/src/store/views';

export default defineComponent({
  name: 'ManipulatorTool',
  props: {
    // only useful for determining the kind of manipulator
    name: String,
    viewId: {
      type: String,
      required: true,
    },
    manipulatorClass: {
      type: Object,
      required: true,
    },
    options: {
      type: Object,
      default: () => ({}),
    },
  },
  setup(props) {
    const { viewId: viewID, options } = toRefs(props);

    const viewStore = useViewStore();
    const viewProxy = computed(() => viewStore.getViewProxy(viewID.value)!);

    const intStyle = computed(() => {
      return viewProxy.value.isA('vtkView2DProxy')
        ? viewProxy.value.getInteractorStyle2D()
        : viewProxy.value.getInteractorStyle3D();
    });

    const manipulator = props.manipulatorClass.newInstance(options.value);

    watch(options, (newOptions) => {
      if ('button' in newOptions) {
        manipulator.setButton(newOptions.button);
      }
      if ('shift' in newOptions) {
        manipulator.setShift(newOptions.shift);
      }
      if ('control' in newOptions) {
        manipulator.setControl(newOptions.control);
      }
    });

    onMounted(() => {
      if (manipulator.isA('vtkCompositeMouseManipulator')) {
        intStyle.value.addMouseManipulator(manipulator);
      }
    });

    onBeforeUnmount(() => {
      if (!viewProxy.value.isDeleted()) {
        if (manipulator.isA('vtkCompositeMouseManipulator')) {
          intStyle.value.removeMouseManipulator(manipulator);
        }
      }
    });

    return () => null;
  },
});
</script>
