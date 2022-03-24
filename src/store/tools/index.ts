import { defineStore } from 'pinia';

export enum Tools {
  WindowLevel = 'WindowLevel',
  Ruler = 'Ruler',
}

interface State {
  currentTool: Tools;
}

export const useToolStore = defineStore('tool', {
  state: (): State => ({
    currentTool: Tools.WindowLevel,
  }),
  actions: {
    setCurrentTool(tool: Tools) {
      this.currentTool = tool;
    },
  },
});
