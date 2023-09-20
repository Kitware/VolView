import { Manifest, StateFile } from '@/src/io/state-file/schema';
import { Maybe } from '@/src/types';
import type { AnnotationToolStore } from '@/src/store/tools/useAnnotationTool';
import { defineStore } from 'pinia';
import { useCropStore } from './crop';
import { useCrosshairsToolStore } from './crosshairs';
import { usePaintToolStore } from './paint';
import { useRulerStore } from './rulers';
import { useRectangleStore } from './rectangles';
import { AnnotationToolType, IToolStore, Tools } from './types';
import { usePolygonStore } from './polygons';

interface State {
  currentTool: Tools;
}

// TODO move these types out
export const AnnotationToolStoreMap: Record<
  AnnotationToolType,
  () => AnnotationToolStore
> = {
  [AnnotationToolType.Polygon]: usePolygonStore,
  [AnnotationToolType.Rectangle]: useRectangleStore,
  [AnnotationToolType.Ruler]: useRulerStore,
} as const;

export const ToolStoreMap: Record<Tools, Maybe<() => IToolStore>> = {
  [Tools.Pan]: null,
  [Tools.WindowLevel]: null,
  [Tools.Zoom]: null,
  [Tools.Select]: null,
  [Tools.Crop]: useCropStore,
  [Tools.Crosshairs]: useCrosshairsToolStore,
  [Tools.Paint]: usePaintToolStore,
  ...AnnotationToolStoreMap,
} as const;

export function useAnnotationToolStore(
  type: AnnotationToolType
): AnnotationToolStore {
  const useStore = AnnotationToolStoreMap[type];
  return useStore();
}

/**
 * Returns true if the tool is ready to be
 * activated. By default, a tool without a
 * store setup() will be activated.
 */
function setupTool(tool: Tools) {
  const useStore = ToolStoreMap[tool];
  const store = useStore?.();
  if (store) {
    return store.activateTool?.();
  }
  return true;
}

function teardownTool(tool: Tools) {
  const useStore = ToolStoreMap[tool];
  const store = useStore?.();
  if (store) {
    store.deactivateTool?.();
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

      Object.values(ToolStoreMap)
        .map((useStore) => useStore?.())
        .filter((store): store is IToolStore => !!store)
        .forEach((store) => {
          store.serialize?.(state);
        });

      tools.current = this.currentTool;
    },
    deserialize(
      manifest: Manifest,
      labelmapIDMap: Record<string, string>,
      dataIDMap: Record<string, string>
    ) {
      const { tools } = manifest;

      Object.values(ToolStoreMap)
        .map((useStore) => useStore?.())
        .filter((store): store is IToolStore => !!store)
        .forEach((store) => {
          store.deserialize?.(manifest, dataIDMap);
        });

      this.currentTool = tools.current;
    },
  },
});
