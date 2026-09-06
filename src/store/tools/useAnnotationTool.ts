import { Ref, computed, ref, watch } from 'vue';
import type { Vector3 } from '@kitware/vtk.js/types';
import type { Maybe, PartialWithRequired, UnwrapAll } from '@/src/types';
import {
  STROKE_WIDTH_ANNOTATION_TOOL_DEFAULT,
  TOOL_COLORS,
} from '@/src/config';
import { isRecord, removeFromArray } from '@/src/utils';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { onImageDeleted } from '@/src/composables/onImageDeleted';
import { declareManifestRefs } from '@/src/core/manifestRefs';
import { AnnotationTool, ToolID } from '@/src/types/annotation-tool';
import { useIdStore } from '@/src/store/id';
import { useToolSelectionStore } from '@/src/store/tools/toolSelection';
import type { IToolStore } from '@/src/store/tools/types';
import { applyLocator } from '@/src/core/annotations/locator';
import type { ToolSegmentRegistry, ToolWireIdentity } from './segmentRegistry';

// Shared manifest-ref declaration for the annotation-tool stores. Each store
// calls this at module scope next to its serialize, pairing the dev-backstop
// coverage with the onImageDeleted cascade this composable registers.
export const declareAnnotationToolManifestRefs = (
  key: 'rulers' | 'rectangles' | 'polygons'
) =>
  declareManifestRefs(`tools.${key}`, (manifest) => {
    const tools = isRecord(manifest.tools) ? manifest.tools : {};
    const section = tools[key];
    if (!isRecord(section) || !Array.isArray(section.tools)) return [];
    return section.tools.flatMap((entry, index) =>
      isRecord(entry) && typeof entry.imageID === 'string'
        ? [
            {
              kind: 'dataset' as const,
              id: entry.imageID,
              where: `tools.${key}[${index}].imageID`,
            },
          ]
        : []
    );
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
  LabelProps,
>({
  toolDefaults,
  segments,
}: {
  toolDefaults: MakeToolDefaults;
  // Factory, not the invoked registry: tools are created inside store setup.
  segments: () => ToolSegmentRegistry<LabelProps>;
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

  const registry = segments();

  function makePropsFromLabel(label: Maybe<string>) {
    if (!label) return { labelName: '' };

    const labelProps = registry.allLabels.value[label];
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
      label: registry.activeLabel.value,
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

  // Starting an annotation is the edit that resolves the segment it delineates:
  // one begun against nothing mints a segment the way a first paint stroke
  // does, so the annotation is drawn in that segment's color while it is still
  // being placed. Idempotent, since the tool then names a live segment.
  function resolveToolLabel(id: ToolID) {
    const tool = toolByID.value[id];
    if (!tool) return;

    const label = registry.resolveLabelForImage(tool.imageID, tool.label);
    if (label === tool.label) return;
    updateTool(id, { label, ...makePropsFromLabel(label) } as ToolPatch);
  }

  // Placing resolves too, for an annotation that arrived without one of the
  // gestures that would have.
  function placeTool(id: ToolID) {
    resolveToolLabel(id);
    updateTool(id, { placing: false } as ToolPatch);
  }

  // Delete-base cleanup: a removed image's tools
  // must not linger — they are invisible in the UI (tool lists filter to the
  // current image) and an orphaned imageID in the next save manifest is the
  // backend's intentional fail-closed 400. Mirrors the segment-group cascade.
  onImageDeleted((deletedIDs) => {
    const deleted = new Set(deletedIDs);
    toolIDs.value
      .filter((id) => deleted.has(toolByID.value[id].imageID))
      .forEach((id) => removeTool(id));
  });

  // Labels recompute on any segment change, so only a tool whose label props
  // actually differ is rewritten.
  watch(registry.allLabels, () => {
    toolIDs.value.forEach((id) => {
      const tool = toolByID.value[id];
      const propsFromLabel = makePropsFromLabel(tool.label);
      const changed = Object.entries(propsFromLabel).some(
        ([key, value]) => (tool as Record<string, unknown>)[key] !== value
      );
      if (changed) updateTool(id, { ...tool, ...propsFromLabel });
    });
  });

  const { currentImageID } = useCurrentImage('global');

  function jumpToTool(toolID: ToolID) {
    const tool = toolByID.value[toolID];

    const imageID = currentImageID.value;
    if (!imageID || tool.imageID !== imageID) return;

    applyLocator(imageID, tool);
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
      ...registry.serializeIdentity(),
    };
  };

  type Serialized = {
    tools: PartialWithRequired<Tool, 'imageID'>[];
  } & ToolWireIdentity<Tool>;
  function deserializeTools(
    serialized: Maybe<Serialized>,
    dataIDMap: Record<string, string>,
    segmentIdMap: Record<string, string> = {}
  ) {
    const resolveLabel = registry.adoptIdentity(
      serialized as Maybe<ToolWireIdentity<LabelProps>>,
      segmentIdMap
    );

    serialized?.tools
      .map(({ imageID, label, ...rest }) => {
        const newImageID = dataIDMap[imageID];
        return {
          ...rest,
          imageID: newImageID,
          label: resolveLabel(label),
        } as ToolPatch;
      })
      .forEach((tool) => addTool(tool));
  }

  // A template's id is derived from its name, so renaming one moves it. The
  // annotations that named the old id follow, or they go unlabeled.
  const updateLabel = (
    id: string,
    patch: Parameters<typeof registry.updateLabel>[1]
  ) => {
    const movedTo = registry.updateLabel(id, patch);
    if (movedTo !== id) {
      toolIDs.value
        .filter((toolId) => toolByID.value[toolId].label === id)
        .forEach((toolId) =>
          updateTool(toolId, { label: movedTo } as ToolPatch)
        );
    }
    return movedTo;
  };

  return {
    ...registry,
    updateLabel,
    toolIDs,
    toolByID,
    tools,
    finishedTools,
    addTool,
    removeTool,
    updateTool,
    resolveToolLabel,
    placeTool,
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

export type AnnotationToolStore<T extends AnnotationTool = AnnotationTool> =
  UnwrapAll<AnnotationToolAPI<T>> & IToolStore;
