<script lang="ts">
import { CreateElement, RenderContext } from 'vue';
import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import vtkMouseCameraTrackballZoomToMouseManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomToMouseManipulator';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import ManipulatorTool from './ManipulatorTool.vue';

interface Props {
  viewProxy: vtkViewProxy;
}

export default {
  functional: true,
  render(h: CreateElement, ctx: RenderContext<Props>) {
    const toolStore = useToolStore();
    const toolOptions = [];
    toolOptions.push({ button: 1, control: true });
    if (toolStore.currentTool === Tools.Zoom) {
      // Additionally enable left-button-only action if Zoom tool is active
      toolOptions.push({ button: 1 });
    }

    return h(ManipulatorTool, {
      props: {
        ...ctx.props,
        name: 'ZoomTool',
        manipulatorClass: vtkMouseCameraTrackballZoomToMouseManipulator,
        options: toolOptions,
      },
    });
  },
};
</script>
