<script lang="ts">
import vtkMouseCameraTrackballZoomManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomManipulator';
import ManipulatorTool from './ManipulatorTool.vue';

export default {
  functional: true,
  render(h, ctx) {
    return h(ManipulatorTool, {
      props: {
        ...ctx.props,
        name: 'ZoomTool',
        manipulatorClass: vtkMouseCameraTrackballZoomManipulator,
        options: {
          button: 1,
          control: true,
        },
      },
    });
  },
};
</script>
