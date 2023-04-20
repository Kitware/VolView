import { Ref, computed, del, ref, set } from '@vue/composition-api';
import { removeFromArray } from '@/src/utils';

import { TOOL_COLORS } from '@/src/config';
import { defineStore } from 'pinia';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import {
  FrameOfReference,
  frameOfReferenceToImageSliceAndAxis,
} from '@/src/utils/frameOfReference';
import { useViewStore } from '@/src/store/views';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import { useViewConfigStore } from '@/src/store/view-configs';
import { LPSAxisDir } from '@/src/types/lps';
import { findImageID, getDataID } from '@/src/store/datasets';

const useDependencyInjectionStore = defineStore('dependencyInjection', {});
const useIDGenerator = () => {
  const { $id } = useDependencyInjectionStore();
  return $id;
};

type AnnotationTool = {
  id: string;
  color: typeof TOOL_COLORS[number];
  imageID: string;
  slice: number;
  placing?: boolean;
  frameOfReference: FrameOfReference;
};

export const useAnnotationTool = <Tool extends AnnotationTool>({
  toolDefaults,
}: {
  toolDefaults: Tool;
}) => {
  type ToolPatch = Partial<Omit<Tool, 'id'>>;
  type ToolID = Tool['id'];

  // cast to Ref<ToolID[]> needed. https://github.com/vuejs/core/issues/2136#issuecomment-693524663
  const toolIDs = ref<ToolID[]>([]) as Ref<ToolID[]>;
  const toolByID = ref<Record<ToolID, Tool>>(Object.create(null)) as Ref<
    Record<ToolID, Tool>
  >;

  const tools = computed(() => {
    const byID = toolByID.value;
    return toolIDs.value.map((id) => byID[id]);
  });

  let colorIndex = -1;
  function getNextColor() {
    colorIndex = (colorIndex + 1) % TOOL_COLORS.length;
    return TOOL_COLORS[colorIndex];
  }

  const idGenerator = useIDGenerator();

  const addTool = (tool: ToolPatch): ToolID => {
    const id = idGenerator.nextID() as ToolID;
    if (id in toolByID.value) {
      throw new Error('Cannot add tool with conflicting ID');
    }
    const color = tool.color ?? getNextColor();
    set(toolByID.value, id, {
      ...toolDefaults,
      ...tool,
      id,
      color,
    });
    toolIDs.value.push(id);
    return id;
  };

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

  const activateTool = () => true;
  const deactivateTool = () => {};

  const serialize = () =>
    toolIDs.value
      .map((toolID) => toolByID.value[toolID])
      .filter((tool) => !tool.placing)
      // If parent image is DICOM, save VolumeKey
      .map(({ imageID, ...rest }) => ({
        imageID: getDataID(imageID),
        ...rest,
      }));

  const deserialize = (
    serialized: Tool[],
    dataIDMap: Record<string, string>
  ) => {
    serialized
      .map(
        ({ imageID, ...rest }) =>
          ({
            ...rest,
            imageID: findImageID(dataIDMap[imageID]),
          } as Tool)
      )
      .forEach(addTool);
  };

  return {
    toolIDs,
    toolByID,
    tools,
    addTool,
    removeTool,
    updateTool,
    jumpToTool,
    activateTool,
    deactivateTool,
    serialize,
    deserialize,
  };
};
