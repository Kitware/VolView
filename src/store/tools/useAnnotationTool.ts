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
import type { SegmentTypeRegistry } from './segmentTypeRegistry';

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
        ...(typeof entry.typeId === 'string' && entry.typeId
          ? [
              {
                kind: 'segmentType' as const,
                id: entry.typeId,
                where: `tools.${key}[${index}].typeId`,
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
  typeId: '',
  name: 'baseAnnotationTool',
});

// Must return addTool in consuming Pinia store.
export const useAnnotationTool = <
  MakeToolDefaults extends (...args: any) => any,
>({
  toolDefaults,
  types,
}: {
  toolDefaults: MakeToolDefaults;
  // Factory, not the invoked registry: tools are created inside store setup.
  types: () => SegmentTypeRegistry;
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

  const registry = types();

  function addTool(tool: ToolPatch): ToolID {
    const id = useIdStore().nextId() as ToolID;
    if (id in toolByID.value) {
      throw new Error('Cannot add tool with conflicting ID');
    }

    toolByID.value[id] = {
      ...makeAnnotationToolDefaults(),
      ...toolDefaults(),
      typeId: registry.selectedTypeId.value ?? '',
      ...tool,
      id,
    };

    toolIDs.value.push(id);
    return id;
  }

  /** The appearance a tool draws with, resolved from its type. */
  const appearanceOfTool = (id: ToolID) =>
    registry.appearanceOf(toolByID.value[id]?.typeId);

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

  // Starting an annotation is the gesture that names the type it delineates:
  // one begun against nothing mints and selects a type the way a first paint
  // stroke does, so it is drawn in that type's color while it is still being
  // placed. Idempotent, since the tool then names a live type.
  function resolveToolType(id: ToolID) {
    const tool = toolByID.value[id];
    if (!tool || registry.getType(tool.typeId)) return;
    updateTool(id, { typeId: registry.ensureSelectedType() } as ToolPatch);
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
  // backend's intentional fail-closed 400. Mirrors the segment-group cascade.
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
  // A type the restore did not recreate leaves the shape unlabeled, drawn in
  // the app defaults; renaming a type never reaches here, since ids are stable.
  function deserializeTools(
    serialized: Maybe<Serialized>,
    dataIDMap: Record<string, string>,
    typeIdMap: Record<string, string> = {}
  ) {
    serialized?.tools
      .map(({ imageID, typeId, ...rest }) => {
        const newImageID = dataIDMap[imageID];
        return {
          ...rest,
          imageID: newImageID,
          typeId: (typeId && typeIdMap[typeId]) || '',
        } as ToolPatch;
      })
      .forEach((tool) => addTool(tool));
  }

  // Shapes reference a type; deleting one takes its shapes with it.
  const removeToolsOfType = (typeId: string) =>
    toolIDs.value
      .filter((id) => toolByID.value[id].typeId === typeId)
      .forEach((id) => removeTool(id));

  const hasToolsOfType = (typeId: string) =>
    toolIDs.value.some((id) => toolByID.value[id].typeId === typeId);

  return {
    types: markRaw(registry),
    appearanceOfTool,
    removeToolsOfType,
    hasToolsOfType,
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
