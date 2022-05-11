import { defineStore } from 'pinia';
import { useRulerToolStore } from './rulers';

export enum Tools {
  WindowLevel = 'WindowLevel',
  Ruler = 'Ruler',
  Paint = 'Paint',
}

interface State {
  currentTool: Tools;
}

function teardownTool(tool: Tools) {
  if (tool === Tools.Ruler) {
    const rulerStore = useRulerToolStore();
    if (rulerStore.activeRulerID) {
      rulerStore.removeRuler(rulerStore.activeRulerID);
    }
  }
}

export const useToolStore = defineStore('tool', {
  state: (): State => ({
    currentTool: Tools.WindowLevel,
  }),
  actions: {
    setCurrentTool(tool: Tools) {
      teardownTool(this.currentTool);
      this.currentTool = tool;
    },
  },
});
