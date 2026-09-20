import { Ref, computed, markRaw, ref } from 'vue';
import type { Vector3 } from '@kitware/vtk.js/types';
import type { Maybe, PartialWithRequired, UnwrapAll } from '@/src/types';
import { isRecord, removeFromArray } from '@/src/utils';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { onImageDeleted } from '@/src/composables/onImageDeleted';
import { declareManifestRefs } from '@/src/core/manifestRefs';
import { AnnotationTool, ToolID } from '@/src/types/annotation-tool';
import { useIdStore } from '@/src/store/id';
import { useToolSelectionStore } from '@/src/store/tools/toolSelection';
import type { IToolStore } from '@/src/store/tools/types';
import { applyLocator } from '@/src/core/annotations/locator';
import type { SegmentRegistry } from '@/src/segmentation/segmentRegistry';
import { declareSegmentReferences } from '@/src/segmentation/segmentReferences';

// Shared manifest-ref declaration for the annotation-tool stores. Each store
// calls this at module scope next to its serialize, pairing the dev-backstop
// coverage with the onImageDeleted cascade this composable registers.
export type AnnotationToolKey = 'rulers' | 'rectangles' | 'polygons';

export const declareAnnotationToolManifestRefs = (key: AnnotationToolKey) =>
  declareManifestRefs(`tools.${key}`, (manifest) => {
    const tools = isRecord(manifest.tools) ? manifest.tools : {};
    const section = tools[key];
    if (!isRecord(section) || !Array.isArray(section.tools)) return [];
    return section.tools.flatMap((entry, index) => {
      if (!isRecord(entry)) return [];
      return [
        ...(typeof entry.imageID === 'string'
          ? [
              {
                kind: 'dataset' as const,
                id: entry.imageID,
                where: `tools.${key}[${index}].imageID`,
              },
            ]
          : []),
        ...(typeof entry.segmentId === 'string' && entry.segmentId
          ? [
              {
                kind: 'segment' as const,
                id: entry.segmentId,
                where: `tools.${key}[${index}].segmentId`,
              },
            ]
          : []),
      ];
    });
  });

const makeAnnotationToolDefaults = () => ({
  frameOfReference: {
    planeOrigin: [0, 0, 0],
    planeNormal: [1, 0, 0],
  },
  slice: -1,
  imageID: '',
  placing: false,
  segmentId: '',
  name: 'baseAnnotationTool',
});

// Must return addTool in consuming Pinia store.
export const useAnnotationTool = <
  MakeToolDefaults extends (...args: any) => any,
>({
  toolDefaults,
  segments,
  manifestKey,
}: {
  toolDefaults: MakeToolDefaults;
  // Factory, not the invoked registry: tools are created inside store setup.
  segments: () => SegmentRegistry;
  // The manifest section this tool owns, which is also its reference-holder id.
  manifestKey: AnnotationToolKey;
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

  function addTool(tool: ToolPatch): ToolID {
    const id = useIdStore().nextId() as ToolID;
    if (id in toolByID.value) {
      throw new Error('Cannot add tool with conflicting ID');
    }

    toolByID.value[id] = {
      ...makeAnnotationToolDefaults(),
      ...toolDefaults(),
      segmentId: registry.selectedSegmentId.value ?? '',
      ...tool,
      id,
    };

    toolIDs.value.push(id);
    return id;
  }

  const appearanceOfTool = (id: ToolID) =>
    registry.appearanceOf(toolByID.value[id]?.segmentId);

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

  // Starting an annotation is the gesture that names the segment it delineates:
  // one begun against nothing mints and selects a segment the way a first paint
  // stroke does, so it is drawn in that segment's color while it is still being
  // placed. Idempotent, since the tool then names a live segment.
  function resolveToolType(id: ToolID) {
    const tool = toolByID.value[id];
    if (!tool || registry.getSegment(tool.segmentId)) return;
    updateTool(id, {
      segmentId: registry.ensureSelectedSegment(),
    } as ToolPatch);
  }

  // Placing resolves too, for an annotation that arrived without one of the
  // gestures that would have.
  function placeTool(id: ToolID) {
    resolveToolType(id);
    updateTool(id, { placing: false } as ToolPatch);
  }

  // Delete-base cleanup: a removed image's tools
  // must not linger — they are invisible in the UI (tool lists filter to the
  // current image) and an orphaned imageID in the next save manifest is the
  // backend's intentional fail-closed 400. Mirrors the segmentation cascade.
  onImageDeleted((deletedIDs) => {
    const deleted = new Set(deletedIDs);
    toolIDs.value
      .filter((id) => deleted.has(toolByID.value[id].imageID))
      .forEach((id) => removeTool(id));
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

    return { tools: toolsSerialized };
  };

  type Serialized = {
    tools: PartialWithRequired<Tool, 'imageID'>[];
  };
  // An unmapped segment leaves its shape unnamed. An adopted segment deleted
  // during mask IO instead takes its pending shapes with it, just as it takes
  // already attached shapes; a same-name replacement has a different id.
  function deserializeTools(
    serialized: Maybe<Serialized>,
    dataIDMap: Record<string, string>,
    segmentIdMap: Record<string, string> = {}
  ) {
    serialized?.tools
      .filter(({ segmentId }) => {
        const mappedId = segmentId && segmentIdMap[segmentId];
        return !mappedId || registry.getSegment(mappedId);
      })
      // An image that did not load leaves its annotations with nothing to hang
      // on: they cannot be drawn, and seating them with a missing image would
      // make the next save's whole tools section invalid.
      .filter(({ imageID }) => dataIDMap[imageID] !== undefined)
      .map(
        ({ imageID, segmentId, ...rest }) =>
          ({
            ...rest,
            imageID: dataIDMap[imageID],
            segmentId: (segmentId && segmentIdMap[segmentId]) || '',
          }) as ToolPatch
      )
      .forEach((tool) => addTool(tool));
  }

  // A tool still being placed is the widget's own stub, not content: taking it
  // with a deleted segment would leave the widget holding a dead id and no way
  // to place anything, and placing re-resolves the segment anyway.
  const referencesSegment = (id: ToolID, segmentId: string) => {
    const tool = toolByID.value[id];
    return tool.segmentId === segmentId && !tool.placing;
  };

  const removeToolsOfSegment = (segmentId: string) =>
    toolIDs.value
      .filter((id) => referencesSegment(id, segmentId))
      .forEach((id) => removeTool(id));

  const hasToolsOfSegment = (segmentId: string) =>
    toolIDs.value.some((id) => referencesSegment(id, segmentId));

  declareSegmentReferences(manifestKey, {
    has: hasToolsOfSegment,
    remove: removeToolsOfSegment,
  });

  return {
    segments: markRaw(registry),
    appearanceOfTool,
    removeToolsOfSegment,
    hasToolsOfSegment,
    toolIDs,
    toolByID,
    tools,
    finishedTools,
    addTool,
    removeTool,
    updateTool,
    resolveToolType,
    placeTool,
    jumpToTool,
    serializeTools,
    deserializeTools,
  };
};

type ToolFactory<T extends AnnotationTool> = (...args: any[]) => T;

export type AnnotationToolAPI<T extends AnnotationTool> = ReturnType<
  typeof useAnnotationTool<ToolFactory<T>>
> & {
  getPoints(id: ToolID): Vector3[];
};

export type AnnotationToolStore<T extends AnnotationTool = AnnotationTool> =
  UnwrapAll<AnnotationToolAPI<T>> & IToolStore;
