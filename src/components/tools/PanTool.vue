<script lang="ts">
import { CreateElement, RenderContext } from 'vue';
import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import vtkMouseCameraTrackballPanManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballPanManipulator';
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
