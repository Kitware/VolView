import { Manifest, StateFile } from '@/src/io/state-file/schema';
import { Maybe } from '@/src/types';
import type { AnnotationToolStore } from '@/src/store/tools/useAnnotationTool';
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useCropStore } from './crop';
import { useCrosshairsToolStore } from './crosshairs';
import { usePaintToolStore } from './paint';
import { useRulerStore } from './rulers';
import { useRectangleStore } from './rectangles';
import { AnnotationToolType, IToolStore, Tools } from './types';
import { usePolygonStore } from './polygons';
import { useToolSelectionStore } from './toolSelection';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useViewStore } from '@/src/store/views';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import {
  EffectiveView,
  getEffectiveView,
} from '@/src/core/views/effectiveView';

const CINE_DISALLOWED_TOOLS = new Set([
  Tools.Paint,
  Tools.Crop,
  Tools.Crosshairs,
]);

export function isToolAllowedFor(tool: Tools, effective: EffectiveView | null) {
  if (effective?.kind === 'cine' && CINE_DISALLOWED_TOOLS.has(tool))
    return false;
  return true;
}

// These tools draw into the selected segment, so picking one up seats a
// segment: the palette shows the color the next stroke will be before it is
// made. Seating allocates no voxels.
const SEGMENT_TOOLS = new Set([
  Tools.Paint,
  Tools.Rectangle,
  Tools.Ruler,
  Tools.Polygon,
]);

const activeEffectiveView = () => getEffectiveView(useViewStore().activeView);

function coerceForEffective(tool: Tools, effective: EffectiveView | null) {
  return isToolAllowedFor(tool, effective) ? tool : Tools.Select;
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
 * Deletes every currently selected annotation, across all annotation types.
 *
 * removeTool() drops the tool from the selection as it goes, so iterate over a
 * snapshot rather than the live selection.
 */
export function removeSelectedTools() {
  const selectionStore = useToolSelectionStore();

  [...selectionStore.selection].forEach(({ id, type }) => {
    useAnnotationToolStore(type).removeTool(id);
  });

  // clears any entry whose tool was already gone
  selectionStore.clearSelection();
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
  const { currentImageID } = useCurrentImage('global');

  function setCurrentTool(tool: Tools) {
    const coerced = coerceForEffective(tool, activeEffectiveView());
    if (currentTool.value === coerced) {
      return;
    }
    if (!setupTool(coerced)) {
      return;
    }
    teardownTool(currentTool.value);
    currentTool.value = coerced;
    // A shortcut can pick a tool up with no image, where a seat would linger.
    if (SEGMENT_TOOLS.has(coerced) && currentImageID.value) {
      useSegmentStore().segments.ensureSelectedSegment();
    }
  }

  // Shared by the toolbar and the Paint hints, so no hint asks for a disabled tool.
  const paintUnavailableReason = computed(() => {
    if (!currentImageID.value) return 'Load an image to paint';
    const kind = activeEffectiveView()?.kind;
    if (kind === 'cine') return 'A clip cannot be painted';
    if (kind === 'oblique')
      return 'Painting is not available in an oblique view';
    return '';
  });

  function activateTemporaryCrosshairs() {
    if (!isToolAllowedFor(Tools.Crosshairs, activeEffectiveView())) return;
    toolBeforeTemporaryCrosshairs.value = currentTool.value;
    setCurrentTool(Tools.Crosshairs);
    useCrosshairsToolStore().setDragging(true);
  }

  function deactivateTemporaryCrosshairs() {
    useCrosshairsToolStore().setDragging(false);
    setCurrentTool(toolBeforeTemporaryCrosshairs.value);
  }

  watch(
    () => activeEffectiveView()?.kind ?? null,
    () => {
      const eff = activeEffectiveView();
      const coerced = coerceForEffective(currentTool.value, eff);
      if (coerced !== currentTool.value) {
        teardownTool(currentTool.value);
        currentTool.value = coerced;
      }
    }
  );

  function serialize(state: StateFile) {
    const { tools } = state.manifest;
    if (!tools) return;

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
    segmentIdMap: Record<string, string>,
    dataIDMap: Record<string, string>
  ) {
    Object.values(ToolStoreMap)
      .map((useStore) => useStore?.())
      .filter((store): store is IToolStore => !!store)
      .forEach((store) => {
        store.deserialize?.(manifest, dataIDMap, segmentIdMap);
      });

    if (manifest.tools?.current) {
      currentTool.value = coerceForEffective(
        manifest.tools.current,
        activeEffectiveView()
      );
    }
  }

  return {
    currentTool,
    paintUnavailableReason,
    setCurrentTool,
    serialize,
    deserialize,
    activateTemporaryCrosshairs,
    deactivateTemporaryCrosshairs,
  };
});
