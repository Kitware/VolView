<script lang="ts">
import { CreateElement, RenderContext } from 'vue';
import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import vtkMouseCameraTrackballZoomToMouseManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomToMouseManipulator';
import { Tools, useToolStore } from '@/src/store/tools';
import ManipulatorTool from './ManipulatorTool.vue';

interface Props {
  viewProxy: vtkViewProxy;
}

export default {
  functional: true,
  render(h: CreateElement, ctx: RenderContext<Props>) {
    const toolStore = useToolStore();
    // only enable control button if Zoom tool is not active
    const control = toolStore.currentTool !== Tools.Zoom;

    return h(ManipulatorTool, {
      props: {
        ...ctx.props,
        name: 'ZoomTool',
        manipulatorClass: vtkMouseCameraTrackballZoomToMouseManipulator,
        options: {
          button: 1,
          control,
        },
      },
    });
  },
};
</script>
