import { defineStore } from 'pinia';
import { useCrosshairsToolStore } from './crosshairs';
import { usePaintToolStore } from './paint';
import { useRulerStore } from './rulers';

export enum Tools {
  WindowLevel = 'WindowLevel',
  Pan = 'Pan',
  Zoom = 'Zoom',
  Ruler = 'Ruler',
  Paint = 'Paint',
  Crosshairs = 'Crosshairs',
  Crop = 'Crop',
}

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
  },
});
