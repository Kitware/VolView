import { Manifest, StateFile } from '@/src/io/state-file/schema';
import { Maybe } from '@/src/types';
import type { AnnotationToolStore } from '@/src/store/tools/useAnnotationTool';
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useCropStore } from './crop';
import { useCrosshairsToolStore } from './crosshairs';
import { usePaintToolStore } from './paint';
import { useRulerStore } from './rulers';
import { useRectangleStore } from './rectangles';
import { AnnotationToolType, IToolStore, Tools } from './types';
import { usePolygonStore } from './polygons';

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
  if (store?.activateTool) {
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

export const useToolStore = defineStore('tool', () => {
  const currentTool = ref(Tools.WindowLevel);
  const toolBeforeTemporaryCrosshairs = ref<Tools>(currentTool.value);

  function setCurrentTool(tool: Tools) {
    if (currentTool.value === tool) {
      return;
    }
    if (!setupTool(tool)) {
      return;
    }
    teardownTool(currentTool.value);
    currentTool.value = tool;
  }

  function activateTemporaryCrosshairs() {
    toolBeforeTemporaryCrosshairs.value = currentTool.value;
    setCurrentTool(Tools.Crosshairs);
    useCrosshairsToolStore().setDragging(true);
  }

  function deactivateTemporaryCrosshairs() {
    useCrosshairsToolStore().setDragging(false);
    setCurrentTool(toolBeforeTemporaryCrosshairs.value);
  }

  function serialize(state: StateFile) {
    const { tools } = state.manifest;

    Object.values(ToolStoreMap)
      .map((useStore) => useStore?.())
      .filter((store): store is IToolStore => !!store)
      .forEach((store) => {
        store.serialize?.(state);
      });

    tools.current = currentTool.value;
  }

  function deserialize(
    manifest: Manifest,
    segmentGroupIDMap: Record<string, string>,
    dataIDMap: Record<string, string>
  ) {
    const { tools } = manifest;

    usePaintToolStore().deserialize(manifest, segmentGroupIDMap);

    Object.values(ToolStoreMap)
      // paint store uses segmentGroupIDMap
      .filter((useStore) => useStore !== usePaintToolStore)
      .map((useStore) => useStore?.())
      .filter((store): store is IToolStore => !!store)
      .forEach((store) => {
        store.deserialize?.(manifest, dataIDMap);
      });

    currentTool.value = tools.current;
  }

  return {
    currentTool,
    setCurrentTool,
    serialize,
    deserialize,
    activateTemporaryCrosshairs,
    deactivateTemporaryCrosshairs,
  };
});
