<script lang="ts">
import {
  computed,
  defineComponent,
  PropType,
  onBeforeUnmount,
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
      type: Array as PropType<Array<any>>,
      default: () => [],
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

    const manipulators: any[] = [];

    function updateStyle(
      style: any,
      newManipulators: any[],
      oldManipulators: any[]
    ) {
      if (style !== null) {
        oldManipulators.forEach((m) => style.removeMouseManipulator(m));
        newManipulators.forEach((m) => style.addMouseManipulator(m));
      }
    }

    watch(
      options,
      (newOptions) => {
        // Maintain the size of manipulators array equal to options array.
        while (manipulators.length > newOptions.length) {
          const m = manipulators.pop();
          intStyle.value.removeMouseManipulator(m);
          m.delete();
        }

        const oldManipulators = Array.from(manipulators);

        for (let i = manipulators.length; i < newOptions.length; ++i) {
          manipulators.push(props.manipulatorClass.newInstance(newOptions[i]));
        }

        newOptions.forEach((opt, idx) => {
          if ('button' in opt) {
            manipulators[idx].setButton(opt.button);
          }
          manipulators[idx].setShift(!!opt.shift);
          manipulators[idx].setControl(!!opt.control);
        });

        updateStyle(intStyle.value, manipulators, oldManipulators);
      },
      { immediate: true }
    );

    watch(
      intStyle,
      (curIntStyle, oldIntStyle) => {
        manipulators.forEach((m) => {
          if (oldIntStyle) {
            oldIntStyle.removeMouseManipulator(m);
          }
          if (curIntStyle) {
            curIntStyle.addMouseManipulator(m);
          }
        });
      },
      { immediate: true }
    );

    onBeforeUnmount(() => {
      if (!viewProxy.value.isDeleted()) {
        manipulators.forEach((m) => intStyle.value.removeMouseManipulator(m));
      }
    });

    return () => null;
  },
});
</script>
