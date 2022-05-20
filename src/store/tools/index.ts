import { defineStore } from 'pinia';
import { usePaintToolStore } from './paint';
import { useRulerToolStore } from './rulers';

export enum Tools {
  WindowLevel = 'WindowLevel',
  Ruler = 'Ruler',
  Paint = 'Paint',
}

interface State {
  currentTool: Tools;
}

export interface IToolStore {
  setup: () => boolean;
  teardown: () => void;
}

function getStore(tool: Tools): IToolStore | null {
  if (tool === Tools.Ruler) {
    return useRulerToolStore();
  }
  if (tool === Tools.Paint) {
    return usePaintToolStore();
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
    return store.setup();
  }
  return true;
}

function teardownTool(tool: Tools) {
  const store = getStore(tool);
  if (store) {
    store.teardown();
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
