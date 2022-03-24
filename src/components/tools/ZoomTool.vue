<script lang="ts">
import { CreateElement, RenderContext } from 'vue';
import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import vtkMouseCameraTrackballZoomManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomManipulator';
import ManipulatorTool from './ManipulatorTool.vue';

interface Props {
  viewProxy: vtkViewProxy;
}

export default {
  functional: true,
  render(h: CreateElement, ctx: RenderContext<Props>) {
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
