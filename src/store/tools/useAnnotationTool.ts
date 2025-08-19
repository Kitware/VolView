import { Ref, UnwrapNestedRefs, computed, ref, watch } from 'vue';
import { StoreActions, StoreGetters, StoreState } from 'pinia';
import type { Vector3 } from '@kitware/vtk.js/types';
import type { Maybe, PartialWithRequired } from '@/src/types';
import {
  STROKE_WIDTH_ANNOTATION_TOOL_DEFAULT,
  TOOL_COLORS,
} from '@/src/config';
import { removeFromArray } from '@/src/utils';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { frameOfReferenceToImageSliceAndAxis } from '@/src/utils/frameOfReference';
import { useViewStore } from '@/src/store/views';
import { AnnotationTool, ToolID } from '@/src/types/annotation-tool';
import { useIdStore } from '@/src/store/id';
import { useToolSelectionStore } from '@/src/store/tools/toolSelection';
import type { IToolStore } from '@/src/store/tools/types';
import useViewSliceStore from '../view-configs/slicing';
import { useLabels, Labels } from './useLabels';

const annotationToolLabelDefault = Object.freeze({
  strokeWidth: STROKE_WIDTH_ANNOTATION_TOOL_DEFAULT as number,
});

const makeAnnotationToolDefaults = () => ({
  frameOfReference: {
    planeOrigin: [0, 0, 0],
    planeNormal: [1, 0, 0],
  },
  slice: -1,
  imageID: '',
  placing: false,
  color: TOOL_COLORS[0],
  strokeWidth: STROKE_WIDTH_ANNOTATION_TOOL_DEFAULT,
  name: 'baseAnnotationTool',
});

// Must return addTool in consuming Pinia store.
export const useAnnotationTool = <
  MakeToolDefaults extends (...args: any) => any,
  LabelProps
>({
  toolDefaults,
  initialLabels,
  newLabelDefault,
}: {
  toolDefaults: MakeToolDefaults;
  initialLabels: Labels<LabelProps>;
  newLabelDefault?: LabelProps;
}) => {
  type ToolDefaults = ReturnType<MakeToolDefaults>;
  type Tool = ToolDefaults & AnnotationTool;
  type ToolPatch = Partial<Omit<Tool, 'id'>>;

  const toolIDs = ref<ToolID[]>([]);
  const toolByID = ref<Record<ToolID, Tool>>(Object.create(null)) as Ref<
    Record<ToolID, Tool>
  >;

  const tools = computed(() => {
    const byID = toolByID.value;
    return toolIDs.value.map((id) => byID[id]);
  });

  type FinishedTool = Tool & { placing: true };
  const finishedTools = computed(() =>
    tools.value.filter((tool): tool is FinishedTool => !tool.placing)
  );

  const labels = useLabels({
    ...annotationToolLabelDefault,
    ...newLabelDefault,
  });
  labels.mergeLabels(initialLabels);

  function makePropsFromLabel(label: string | undefined) {
    if (!label) return { labelName: '' };

    const labelProps = labels.labels.value[label];
    if (labelProps) return labelProps;

    // if label deleted, remove label name from tool
    return { labelName: '' };
  }

  function addTool(tool: ToolPatch): ToolID {
    const id = useIdStore().nextId() as ToolID;
    if (id in toolByID.value) {
      throw new Error('Cannot add tool with conflicting ID');
    }

    toolByID.value[id] = {
      ...makeAnnotationToolDefaults(),
      ...toolDefaults(),
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

    const selectionStore = useToolSelectionStore();
    selectionStore.removeSelection(id);
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
      updateTool(id, { ...tool, ...propsFromLabel });
    });
  });

  const { currentImageID, currentImageMetadata } = useCurrentImage('global');

  function jumpToTool(toolID: ToolID) {
    const tool = toolByID.value[toolID];

    const imageID = currentImageID.value;
    if (!imageID || tool.imageID !== imageID) return;

    const toolImageFrame = frameOfReferenceToImageSliceAndAxis(
      tool.frameOfReference,
      currentImageMetadata.value
    );

    if (!toolImageFrame) return;

    const viewStore = useViewStore();
    const relevantViews = viewStore.getAllViews().filter((view) => {
      if (view.type !== '2D') return false;
      const axis = view.options.orientation;
      return axis === toolImageFrame.axis;
    });

    const viewSliceStore = useViewSliceStore();
    relevantViews.forEach((view) => {
      viewSliceStore.updateConfig(view.id, imageID, {
        slice: tool.slice!,
      });
    });
  }

  const serializeTools = () => {
    const toolsSerialized = toolIDs.value
      .map((toolID) => toolByID.value[toolID])
      .filter((tool) => !tool.placing)
      .map(({ imageID, ...rest }) => ({
        imageID,
        ...rest,
      }));

    return {
      tools: toolsSerialized,
      labels: labels.labels.value,
    };
  };

  type Serialized = {
    tools: PartialWithRequired<Tool, 'imageID'>[];
    labels: Labels<Tool>;
  };
  function deserializeTools(
    serialized: Maybe<Serialized>,
    dataIDMap: Record<string, string>
  ) {
    if (serialized?.labels) {
      labels.clearDefaultLabels();
    }
    const labelIDMap = Object.fromEntries(
      Object.entries(serialized?.labels ?? {}).map(([id, label]) => {
        const newID = labels.addLabel(label); // side effect in Array.map
        return [id, newID];
      })
    );

    serialized?.tools
      .map(
        ({ imageID, label, ...rest }) =>
          ({
            ...rest,
            imageID: dataIDMap[imageID],
            label: (label && labelIDMap[label]) || '',
          } as ToolPatch)
      )
      .forEach((tool) => addTool(tool));
  }

  return {
    ...labels,
    toolIDs,
    toolByID,
    tools,
    finishedTools,
    addTool,
    removeTool,
    updateTool,
    jumpToTool,
    serializeTools,
    deserializeTools,
  };
};

type ToolFactory<T extends AnnotationTool> = (...args: any[]) => T;

export type AnnotationToolAPI<T extends AnnotationTool> = ReturnType<
  typeof useAnnotationTool<ToolFactory<T>, any>
> & {
  getPoints(id: ToolID): Vector3[];
};

type UseAnnotationToolBasedStore<T extends AnnotationTool> = StoreState<
  AnnotationToolAPI<T>
> &
  StoreActions<AnnotationToolAPI<T>> &
  UnwrapNestedRefs<StoreGetters<AnnotationToolAPI<T>>>;

export interface AnnotationToolStore<T extends AnnotationTool = AnnotationTool>
  extends UseAnnotationToolBasedStore<T>,
    IToolStore {}
