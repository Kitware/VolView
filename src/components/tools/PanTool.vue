<script lang="ts">
import { CreateElement, RenderContext } from 'vue';
import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import vtkMouseCameraTrackballPanManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballPanManipulator';
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
    toolOptions.push({ button: 1, shift: true });
    if (toolStore.currentTool === Tools.Pan) {
      // Additionally enable left-button-only action if Pan tool is active
      toolOptions.push({ button: 1 });
    }

    return h(ManipulatorTool, {
      props: {
        ...ctx.props,
        name: 'PanTool',
        manipulatorClass: vtkMouseCameraTrackballPanManipulator,
        options: toolOptions,
      },
    });
  },
};
</script>
