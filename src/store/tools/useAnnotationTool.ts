import { Ref, computed, ref, watch } from 'vue';
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
import { useIdStore } from '@/src/store/id';
import useViewSliceStore from '../view-configs/slicing';
import { useLabels, Labels, LabelProps } from './useLabels';

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
export const useAnnotationTool = <
  ToolDefaults,
  ToolActiveProps extends ToolDefaults & AnnotationTool
>({
  toolDefaults,
  initialLabels,
  newLabelDefault = {},
}: {
  toolDefaults: ToolDefaults;
  initialLabels: Labels<ToolActiveProps>;
  newLabelDefault: LabelProps<ToolActiveProps>;
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

  const labels = useLabels<Tool>(newLabelDefault);
  labels.setLabels(initialLabels);

  function makePropsFromLabel(currentLabel: string | undefined) {
    const label = currentLabel ?? labels.activeLabel.value;
    if (!label) return {};
    return labels.labels.value[label];
  }

  function addTool(this: Store, tool: ToolPatch): ToolID {
    const id = useIdStore().nextId() as ToolID;
    if (id in toolByID.value) {
      throw new Error('Cannot add tool with conflicting ID');
    }

    toolByID.value[id] = {
      ...annotationToolDefaults,
      ...toolDefaults,
      label: labels.activeLabel.value,
      ...tool,
      // updates label props if changed between sessions
      ...makePropsFromLabel(tool.label),
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

  // updates props controlled by labels
  watch(labels.labels, () => {
    toolIDs.value.forEach((id) => {
      const tool = toolByID.value[id];
      const propsFromLabel = makePropsFromLabel(tool.label);
      updateTool(id, propsFromLabel);
    });
  });

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
          } as ToolPatch)
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
