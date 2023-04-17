import { defineStore } from 'pinia';
import { computed, del, ref, set } from '@vue/composition-api';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { TOOL_COLORS } from '@/src/config';
import { RequiredWithPartial } from '@/src/types';
import { removeFromArray } from '@/src/utils';
import { frameOfReferenceToImageSliceAndAxis } from '@/src/utils/frameOfReference';
import { LPSAxisDir } from '@/src/types/lps';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import {
  Rectangle,
  PlacingTool,
  RectangleID,
  RectanglePatch,
} from '@/src/types/rectangle';
import { useViewStore } from '../views';
import { useViewConfigStore } from '../view-configs';

export type Tool = Rectangle;
type ToolPatch = RectanglePatch;
export type ToolID = RectangleID;

const createEmptyPlacingTool = (
  id: ToolID,
  color = TOOL_COLORS[0]
): PlacingTool => ({
  id,
  color,
});

const isPlacingToolFinalized = (tool: PlacingTool): tool is Tool =>
  Object.values(tool).every((prop) => prop != null);

export const useRectangleStore = defineStore('rectangles', () => {
  type _This = ReturnType<typeof useRectangleStore>;

  // --- state --- //

  const toolIDs = ref<ToolID[]>([]);
  const toolByID = ref<Record<ToolID, Tool>>(Object.create(null));
  const placingToolByID = ref<Record<ToolID, PlacingTool>>({});

  // used for picking the next tool color
  let colorIndex = -1;
  function getNextColor() {
    colorIndex = (colorIndex + 1) % TOOL_COLORS.length;
    return TOOL_COLORS[colorIndex];
  }

  function getNextPlacingToolID() {
    return `PlacingTool-${Object.keys(placingToolByID.value).length}` as ToolID;
  }

  // --- getters --- //

  const tools = computed(() => {
    const byID = toolByID.value;
    return toolIDs.value.map((id) => byID[id]);
  });

  // --- actions --- //

  function createPlacingTool() {
    const id = getNextPlacingToolID();
    set(placingToolByID.value, id, createEmptyPlacingTool(id, getNextColor()));
    return id;
  }

  function resetPlacingTool(id: ToolID) {
    if (!(id in placingToolByID.value)) {
      return;
    }
    const { color } = placingToolByID.value[id];
    set(placingToolByID.value, id, createEmptyPlacingTool(id, color));
  }

  function isPlacingTool(id: ToolID) {
    return id in placingToolByID.value;
  }

  function addTool(
    this: _This,
    tool: RequiredWithPartial<Tool, 'id' | 'color'>
  ) {
    const id = tool.id ?? (this.$id.nextID() as ToolID);
    if (id in toolByID.value) {
      throw new Error('Cannot add tool with conflicting ID');
    }
    const color = tool.color ?? getNextColor();
    set(toolByID.value, id, {
      ...tool,
      id,
      color,
    });
    toolIDs.value.push(id);
    return id;
  }

  function removeTool(id: ToolID) {
    if (id in toolByID.value) {
      removeFromArray(toolIDs.value, id);
      del(toolByID.value, id);
    } else if (id in placingToolByID.value) {
      del(placingToolByID.value, id);
    }
  }

  function updateTool(id: ToolID, patch: ToolPatch) {
    if (id in placingToolByID.value) {
      set(placingToolByID.value, id, {
        ...placingToolByID.value[id],
        ...patch,
      });
    } else if (id in toolByID.value) {
      set(toolByID.value, id, { ...toolByID.value[id], ...patch });
    }
  }

  /**
   * Saves a given placing tool and returns the new tools's ID.
   *
   * This makes a copy of the placing tool and saves it.
   * @param this
   * @param id
   * @returns
   */
  function commitPlacingTool(this: _This, id: ToolID) {
    const tool = placingToolByID.value[id];
    if (tool && isPlacingToolFinalized(tool)) {
      // allocate a non-placing ID
      const clone = { ...tool, id: this.$id.nextID() as ToolID };
      addTool.call(this, clone);
      resetPlacingTool(id);
      return clone.id;
    }
    return null;
  }

  function jumpToTool(toolID: ToolID) {
    const tool = toolByID.value[toolID];
    const { currentImageID, currentImageMetadata } = useCurrentImage();

    const imageID = currentImageID.value;
    if (!imageID || tool.imageID !== imageID) return;

    const toolImageFrame = frameOfReferenceToImageSliceAndAxis(
      tool.frameOfReference,
      currentImageMetadata.value
    );

    if (!toolImageFrame) return;

    const viewStore = useViewStore();
    const relevantViewIDs = viewStore.viewIDs.filter((viewID) => {
      const viewSpec = viewStore.viewSpecs[viewID];
      const viewDir = viewSpec.props.viewDirection as LPSAxisDir | undefined;
      return viewDir && getLPSAxisFromDir(viewDir) === toolImageFrame.axis;
    });

    const viewConfigStore = useViewConfigStore();
    relevantViewIDs.forEach((viewID) => {
      viewConfigStore.updateSliceConfig(viewID, imageID, {
        slice: tool.slice!,
      });
    });
  }

  return {
    tools,
    toolIDs,
    toolByID,
    placingToolByID,
    createPlacingTool,
    resetPlacingTool,
    isPlacingTool,
    addTool,
    removeTool,
    updateTool,
    commitPlacingTool,
    jumpToTool,
  };
});
