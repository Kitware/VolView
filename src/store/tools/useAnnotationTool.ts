import { Ref, computed, ref } from 'vue';
import { Store } from 'pinia';
import { removeFromArray } from '@/src/utils';

import { TOOL_COLORS } from '@/src/config';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import {
  FrameOfReference,
  frameOfReferenceToImageSliceAndAxis,
} from '@/src/utils/frameOfReference';
import { useViewStore } from '@/src/store/views';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import { LPSAxisDir } from '@/src/types/lps';
import { findImageID, getDataID } from '@/src/store/datasets';
import useViewSliceStore from '../view-configs/slicing';
import { useLabels } from './useLabels';

type AnnotationTool = {
  id: string;
  color: typeof TOOL_COLORS[number];
  imageID: string;
  slice: number;
  frameOfReference: FrameOfReference;
  placing?: boolean;
  label?: string;
};

// Must return addTool in consuming Pinia store.
export const useAnnotationTool = <Tool extends AnnotationTool>({
  toolDefaults,
}: {
  toolDefaults: Tool;
}) => {
  const labels = useLabels();

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

  function addTool(this: Store, tool: ToolPatch): ToolID {
    const id = this.$id.nextID() as ToolID;
    if (id in toolByID.value) {
      throw new Error('Cannot add tool with conflicting ID');
    }
    const color = tool.color ?? labels.activeColor.value ?? getNextColor();
    const label = labels.activeLabel.value;
    toolByID.value[id] = {
      ...toolDefaults,
      ...(label && { label }),
      ...tool,
      id,
      color,
    };
    toolIDs.value.push(id);
    return id;
  }

  function removeTool(id: ToolID) {
    if (!(id in toolByID.value)) return;

    removeFromArray(toolIDs.value, id);
    delete toolByID.value[id];
  }

  function updateTool(id: ToolID, patch: ToolPatch) {
    if (!(id in toolByID.value)) return;

    toolByID.value[id] = { ...toolByID.value[id], ...patch, id };
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

    const viewSliceStore = useViewSliceStore();
    relevantViewIDs.forEach((viewID) => {
      viewSliceStore.updateConfig(viewID, imageID, {
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
      .map(({ imageID, ...rest }) => ({
        imageID: getDataID(imageID), // If parent image is DICOM, save VolumeKey
        ...rest,
      }));

  function deserialize(
    this: Store,
    serialized: Tool[],
    dataIDMap: Record<string, string>
  ) {
    serialized
      .map(
        ({ imageID, label = undefined, ...rest }) =>
          ({
            ...rest,
            imageID: findImageID(dataIDMap[imageID]),
            label,
          } as Tool)
      )
      .forEach((tool) => addTool.call(this, tool));
  }

  return {
    ...labels,
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
