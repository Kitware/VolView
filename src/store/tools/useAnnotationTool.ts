import { Ref, computed, ref } from 'vue';
import { Store } from 'pinia';

import { PartialWithRequired } from '@/src/types';
import { TOOL_COLORS } from '@/src/config';
import { removeFromArray } from '@/src/utils';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { frameOfReferenceToImageSliceAndAxis } from '@/src/utils/frameOfReference';
import { useViewStore } from '@/src/store/views';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import { LPSAxisDir } from '@/src/types/lps';
import { AnnotationTool } from '@/src/types/annotationTool';
import { findImageID, getDataID } from '@/src/store/datasets';

import useViewSliceStore from '../view-configs/slicing';
import { useLabels, Labels } from './useLabels';

const annotationToolDefaults = {
  frameOfReference: {
    planeOrigin: [0, 0, 0],
    planeNormal: [1, 0, 0],
  },
  slice: -1,
  imageID: '',
  placing: false,
  color: TOOL_COLORS[0],
  name: 'baseAnnotationTool',
};

// Must return addTool in consuming Pinia store.
export const useAnnotationTool = <ToolDefaults>({
  toolDefaults,
  initialLabels,
}: {
  toolDefaults: ToolDefaults;
  initialLabels: Labels<ToolDefaults>;
}) => {
  type Tool = ToolDefaults & AnnotationTool;
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

  const labels = useLabels<ToolDefaults>(initialLabels);
  const labelKeys = Object.keys(initialLabels) as Array<keyof ToolDefaults>;

  function makePropsFromLabel(currentLabel: string | undefined) {
    const label = currentLabel ?? labels.activeLabel.value;
    if (!label || labelKeys.length === 0) return {};
    const activeLabelProps = labels.labels.value[label];
    return Object.fromEntries(
      labelKeys.map((prop) => [prop, activeLabelProps[prop]])
    );
  }

  function addTool(this: Store, tool: ToolPatch): ToolID {
    const id = this.$id.nextID() as ToolID;
    if (id in toolByID.value) {
      throw new Error('Cannot add tool with conflicting ID');
    }
    const propsFromLabel = makePropsFromLabel(tool.label);

    toolByID.value[id] = {
      ...annotationToolDefaults,
      ...toolDefaults,
      label: labels.activeLabel.value,
      ...tool,
      ...propsFromLabel,
      id,
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
    serialized: PartialWithRequired<Tool, 'imageID'>[],
    dataIDMap: Record<string, string>
  ) {
    serialized
      .map(
        ({ imageID, ...rest }) =>
          ({
            ...rest,
            imageID: findImageID(dataIDMap[imageID]),
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
