import { defineStore } from 'pinia';
import { computed, del, ref, set } from '@vue/composition-api';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { TOOL_COLORS } from '@/src/config';
import { removeFromArray } from '@/src/utils';
import { frameOfReferenceToImageSliceAndAxis } from '@/src/utils/frameOfReference';
import { LPSAxisDir } from '@/src/types/lps';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import { Manifest, StateFile } from '@/src/io/state-file/schema';
import { Rectangle, RectangleID, RectanglePatch } from '@/src/types/rectangle';
import { useViewStore } from '@/src/store/views';
import { useViewConfigStore } from '@/src/store/view-configs';
import { findImageID, getDataID } from '@/src/store/datasets';

export type Tool = Rectangle;
type ToolPatch = RectanglePatch;
export type ToolID = RectangleID;

const createRectangleWithDefaults = (
  rectangle: Partial<Rectangle>
): Rectangle => ({
  firstPoint: [0, 0, 0],
  secondPoint: [0, 0, 0],
  frameOfReference: {
    planeOrigin: [0, 0, 0],
    planeNormal: [1, 0, 0],
  },
  slice: -1,
  imageID: '',
  id: '' as ToolID,
  name: 'Rectangle',
  color: TOOL_COLORS[0],
  placing: false,
  ...rectangle,
});

export const useRectangleStore = defineStore('rectangles', () => {
  type _This = ReturnType<typeof useRectangleStore>;

  // --- state --- //

  const toolIDs = ref<ToolID[]>([]);
  const toolByID = ref<Record<ToolID, Tool>>(Object.create(null));

  // used for picking the next tool color
  let colorIndex = -1;
  function getNextColor() {
    colorIndex = (colorIndex + 1) % TOOL_COLORS.length;
    return TOOL_COLORS[colorIndex];
  }

  // --- getters --- //

  const tools = computed(() => {
    const byID = toolByID.value;
    return toolIDs.value.map((id) => byID[id]);
  });

  // --- actions --- //

  function addTool(this: _This, tool: ToolPatch) {
    const id = this.$id.nextID() as ToolID;
    if (id in toolByID.value) {
      throw new Error('Cannot add tool with conflicting ID');
    }
    const color = tool.color ?? getNextColor();
    set(
      toolByID.value,
      id,
      createRectangleWithDefaults({
        ...tool,
        id,
        color,
      })
    );
    toolIDs.value.push(id);
    return id;
  }

  function removeTool(id: ToolID) {
    if (!(id in toolByID.value)) return;

    removeFromArray(toolIDs.value, id);
    del(toolByID.value, id);
  }

  function updateTool(id: ToolID, patch: ToolPatch) {
    if (!(id in toolByID.value)) return;

    set(toolByID.value, id, { ...toolByID.value[id], ...patch, id });
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

  // --- tool activation --- //

  function activateTool(this: _This) {
    return true;
  }

  function deactivateTool() {}

  // --- serialization --- //

  function serialize(state: StateFile) {
    state.manifest.tools.rectangles = toolIDs.value
      .map((rectangleID) => toolByID.value[rectangleID])
      // If parent image is DICOM, save VolumeKey
      .map(({ imageID, ...rest }) => ({
        imageID: getDataID(imageID),
        ...rest,
      }));
  }

  function deserialize(
    this: _This,
    manifest: Manifest,
    dataIDMap: Record<string, string>
  ) {
    const rectanglesInState = manifest.tools.rectangles;

    rectanglesInState
      .map(({ imageID, ...rest }) => {
        const newID = dataIDMap[imageID];
        return {
          ...rest,
          imageID: findImageID(newID),
        };
      })
      .forEach((rectangle) => {
        addTool.call(this, rectangle);
      });
  }

  return {
    tools,
    toolIDs,
    toolByID,
    addTool,
    removeTool,
    updateTool,
    jumpToTool,
    activateTool,
    deactivateTool,
    serialize,
    deserialize,
  };
});
