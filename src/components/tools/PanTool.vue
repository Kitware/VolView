<script lang="ts">
import vtkMouseCameraTrackballPanManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballPanManipulator';
import ManipulatorTool from './ManipulatorTool.vue';

export default {
  functional: true,
  render(h, ctx) {
    return h(ManipulatorTool, {
      props: {
        ...ctx.props,
        name: 'PanTool',
        manipulatorClass: vtkMouseCameraTrackballPanManipulator,
        options: {
          button: 1,
          shift: true,
        },
      },
    });
  },
};
</script>
