import { Manifest, StateFile } from '@/src/io/state-file/schema';
import { defineStore } from 'pinia';
import { useCropStore } from './crop';
import { useCrosshairsToolStore } from './crosshairs';
import { usePaintToolStore } from './paint';
import { useRulerStore } from './rulers';
import { useRectangleStore } from './rectangles';
import { Tools } from './types';

interface State {
  currentTool: Tools;
}

export interface IToolStore {
  activateTool: () => boolean;
  deactivateTool: () => void;
}

function getStore(tool: Tools): IToolStore | null {
  if (tool === Tools.Ruler) {
    return useRulerStore();
  }
  if (tool === Tools.Rectangle) {
    return useRectangleStore();
  }
  if (tool === Tools.Paint) {
    return usePaintToolStore();
  }
  if (tool === Tools.Crosshairs) {
    return useCrosshairsToolStore();
  }
  return null;
}

/**
 * Returns true if the tool is ready to be
 * activated. By default, a tool without a
 * store setup() will be activated.
 */
function setupTool(tool: Tools) {
  const store = getStore(tool);
  if (store) {
    return store.activateTool();
  }
  return true;
}

function teardownTool(tool: Tools) {
  const store = getStore(tool);
  if (store) {
    store.deactivateTool();
  }
}

export const useToolStore = defineStore('tool', {
  state: (): State => ({
    currentTool: Tools.WindowLevel,
  }),
  actions: {
    setCurrentTool(tool: Tools) {
      if (!setupTool(tool)) {
        return;
      }
      teardownTool(this.currentTool);
      this.currentTool = tool;
    },
    serialize(state: StateFile) {
      const { tools } = state.manifest;
      const rulerStore = useRulerStore();
      const rectangleStore = useRectangleStore();
      const crosshairsStore = useCrosshairsToolStore();
      const paintStore = usePaintToolStore();
      const cropStore = useCropStore();

      rulerStore.serialize(state);
      rectangleStore.serialize(state);
      crosshairsStore.serialize(state);
      paintStore.serialize(state);
      cropStore.serialize(state);

      tools.current = this.currentTool;
    },
    deserialize(
      manifest: Manifest,
      labelmapIDMap: Record<string, string>,
      dataIDMap: Record<string, string>
    ) {
      const { tools } = manifest;
      const rulerStore = useRulerStore();
      const rectangleStore = useRectangleStore();
      const crosshairsStore = useCrosshairsToolStore();
      const paintStore = usePaintToolStore();
      const cropStore = useCropStore();

      rulerStore.deserialize(manifest, dataIDMap);
      rectangleStore.deserialize(manifest, dataIDMap);
      crosshairsStore.deserialize(manifest);
      paintStore.deserialize(manifest, labelmapIDMap);
      cropStore.deserialize(manifest, dataIDMap);
      this.currentTool = tools.current;
    },
  },
});
