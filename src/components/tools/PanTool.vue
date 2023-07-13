<script lang="ts">
import { h } from 'vue';
import vtkMouseCameraTrackballPanManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballPanManipulator';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import MouseManipulatorTool from './MouseManipulatorTool.vue';

interface Props {
  viewId: string;
  // workaround for vue not detecting kebab-transformed props
  'view-id'?: string;
}

export default function PanTool(props: Props) {
  const toolStore = useToolStore();
  const toolOptions = [];
  toolOptions.push({ button: 2 });
  toolOptions.push({ button: 1, shift: true });
  if (toolStore.currentTool === Tools.Pan) {
    // Additionally enable left-button-only action if Pan tool is active
    toolOptions.push({ button: 1 });
  }

  return h(MouseManipulatorTool, {
    ...props,
    name: 'PanTool',
    manipulatorClass: vtkMouseCameraTrackballPanManipulator,
    options: toolOptions,
  });
}
</script>
