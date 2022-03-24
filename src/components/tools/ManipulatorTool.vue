<script lang="ts">
import {
  defineComponent,
  onBeforeUnmount,
  onMounted,
  PropType,
  toRefs,
} from '@vue/composition-api';
import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';

export default defineComponent({
  name: 'ManipulatorTool',
  props: {
    // only useful for determining the kind of manipulator
    name: String,
    viewProxy: {
      type: Object as PropType<vtkViewProxy>,
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
    const { viewProxy, manipulatorClass, options } = toRefs(props);

    const is2D = viewProxy.value.isA('vtkView2DProxy');
    const istyle = is2D
      ? viewProxy.value.getInteractorStyle2D()
      : viewProxy.value.getInteractorStyle3D();
    const manipulator = manipulatorClass.value.newInstance(options.value);

    onMounted(() => {
      if (manipulator.isA('vtkCompositeMouseManipulator')) {
        istyle.addMouseManipulator(manipulator);
      }
    });

    onBeforeUnmount(() => {
      if (!viewProxy.value.isDeleted()) {
        if (manipulator.isA('vtkCompositeMouseManipulator')) {
          istyle.removeMouseManipulator(manipulator);
        }
      }
    });

    return () => null;
  },
});
</script>
