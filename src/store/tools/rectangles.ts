import { TOOL_COLORS } from '@/src/config';
import { RequiredWithPartial } from '@/src/types';
import {
  Rectangle,
  PlacingRectangle,
  RectangleID,
  RectanglePatch,
} from '@/src/types/rectangle';
import { removeFromArray } from '@/src/utils';
import { computed, del, ref, set } from '@vue/composition-api';
import { defineStore } from 'pinia';

export type Tool = Rectangle;
type ToolPatch = RectanglePatch;
type PlacingTool = PlacingRectangle;
export type ToolID = RectangleID;
export type PlacingToolID = string & { __type: 'PlacingToolID' };

const createEmptyPlacingTool = (
  id: PlacingToolID,
  color = TOOL_COLORS[0]
): PlacingTool => ({
  id,
  color,
});

export const useRectangleStore = defineStore('rectangles', () => {
  type _This = ReturnType<typeof useRectangleStore>;

  // --- state --- //

  const toolIDs = ref<ToolID[]>([]);
  const toolByID = ref<Record<ToolID, Tool>>(Object.create(null));
  const placingToolByID = ref<Record<PlacingToolID, PlacingTool>>({});

  // used for picking the next ruler color
  let colorIndex = -1;
  function getNextColor() {
    colorIndex = (colorIndex + 1) % TOOL_COLORS.length;
    return TOOL_COLORS[colorIndex];
  }

  function getNextPlacingToolID() {
    return `PlacingTool-${
      Object.keys(placingToolByID.value).length
    }` as PlacingToolID;
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

  function resetPlacingTool(id: PlacingToolID) {
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

  function removeTool(id: ToolID | PlacingToolID) {
    if (id in toolByID.value) {
      removeFromArray(toolIDs.value, id);
      del(toolByID.value, id);
    } else if (id in placingToolByID.value) {
      del(placingToolByID.value, id);
    }
  }

  function updateTool(id: ToolID | PlacingToolID, patch: ToolPatch) {
    if (id in placingToolByID.value) {
      set(placingToolByID.value, id, {
        ...placingToolByID.value[id as PlacingToolID],
        ...patch,
      });
    } else if (id in toolByID.value) {
      set(toolByID.value, id, { ...toolByID.value[id as ToolID], ...patch });
    }
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
  };
});
