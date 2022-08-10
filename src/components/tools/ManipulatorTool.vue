<script lang="ts">
import {
  defineComponent,
  onBeforeUnmount,
  onMounted,
  toRefs,
  watch,
} from '@vue/composition-api';
import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
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
    const { viewId: viewID, manipulatorClass, options } = toRefs(props);

    const viewStore = useViewStore();
    const viewProxy = viewStore.getViewProxy<vtkViewProxy>(viewID.value);
    if (!viewProxy) {
      throw new Error('Cannot get the view proxy');
    }

    const is2D = viewProxy.isA('vtkView2DProxy');
    const istyle = is2D
      ? viewProxy.getInteractorStyle2D()
      : viewProxy.getInteractorStyle3D();
    const manipulator = manipulatorClass.value.newInstance(options.value);

    watch(options, (newOptions) => {
      if (props.name === 'PanTool') {
        manipulator.setShift(!newOptions.shift.value);
      } else if (props.name === 'ZoomTool') {
        manipulator.setControl(!newOptions.control.value);
      }
    });

    onMounted(() => {
      if (manipulator.isA('vtkCompositeMouseManipulator')) {
        istyle.addMouseManipulator(manipulator);
      }
    });

    onBeforeUnmount(() => {
      if (!viewProxy.isDeleted()) {
        if (manipulator.isA('vtkCompositeMouseManipulator')) {
          istyle.removeMouseManipulator(manipulator);
        }
      }
    });

    return () => null;
  },
});
</script>
