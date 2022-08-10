<script lang="ts">
import { computed } from '@vue/composition-api';
import { CreateElement, RenderContext } from 'vue';
import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import vtkMouseCameraTrackballPanManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballPanManipulator';
import { Tools, useToolStore } from '@/src/store/tools';
import ManipulatorTool from './ManipulatorTool.vue';

interface Props {
  viewProxy: vtkViewProxy;
}

export default {
  functional: true,
  render(h: CreateElement, ctx: RenderContext<Props>) {
    const toolStore = useToolStore();
    const active = computed(() => toolStore.currentTool === Tools.Pan);

    return h(ManipulatorTool, {
      props: {
        ...ctx.props,
        name: 'PanTool',
        manipulatorClass: vtkMouseCameraTrackballPanManipulator,
        options: {
          button: 1,
          shift: active,
        },
      },
    });
  },
};
</script>
