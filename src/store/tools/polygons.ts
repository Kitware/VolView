import * as polygonClipping from 'polyclip-ts';
import type { Vector3 } from '@kitware/vtk.js/types';
import { computed } from 'vue';
import {
  ToolSelection,
  useToolSelectionStore,
} from '@/src/store/tools/toolSelection';
import { AnnotationToolType } from '@/src/store/tools/types';
import { POLYGON_LABEL_DEFAULTS } from '@/src/config';
import { Manifest, StateFile } from '@/src/io/state-file/schema';
import { getPlaneTransforms } from '@/src/utils/frameOfReference';
import { ToolID } from '@/src/types/annotation-tool';
import { defineAnnotationToolStore } from '@/src/utils/defineAnnotationToolStore';
import { useAnnotationTool } from './useAnnotationTool';

const toolDefaults = () => ({
  points: [] as Array<Vector3>,
  id: '' as ToolID,
  name: 'Polygon',
});

export const usePolygonStore = defineAnnotationToolStore('polygon', () => {
  const toolAPI = useAnnotationTool({
    toolDefaults,
    initialLabels: POLYGON_LABEL_DEFAULTS,
  });

  function getPoints(id: ToolID) {
    const tool = toolAPI.toolByID.value[id];
    return tool.points;
  }

  // -- merge tool helpers -- //
  type Tool = (typeof toolAPI.tools.value)[number];

  const toGeoJSON = (polygon: Tool) => {
    const { to2D } = getPlaneTransforms(polygon.frameOfReference);
    if (polygon.points.length === 0) return undefined; // empty polygons are invalid to polyclip-ts
    return [polygon.points.map(to2D)]; // GeoJSON Polygon can have multiple rings so wrap in array
  };

  const polygonsOverlap = (a: Tool, b: Tool) => {
    const [aGeo, bGeo] = [a, b].map(toGeoJSON);
    if (!aGeo || !bGeo) return false;
    return polygonClipping.intersection(aGeo, bGeo).length > 0;
  };

  const sameSliceAndLabel = (a: Tool, b: Tool) =>
    a.label === b.label &&
    a.slice === b.slice &&
    a.frameOfReference === b.frameOfReference;

  const mergable = (a: Tool, b: Tool) => {
    if (!sameSliceAndLabel(a, b)) return false;
    return polygonsOverlap(a, b);
  };
  // --- //

  const selectionStore = useToolSelectionStore();

  const isPolygonTool = (tool: ToolSelection) =>
    tool.type === AnnotationToolType.Polygon;

  const mergeableTools = computed(() => {
    const selectedPolygons = selectionStore.selection
      .filter(isPolygonTool)
      .map((sel) => {
        return toolAPI.toolByID.value[sel.id];
      });
    if (selectedPolygons.length < 2) return [];
    const [first, ...rest] = selectedPolygons;
    const overlapping = [first];
    while (rest.length > 0) {
      const overlappingIndex = rest.findIndex((candidate) =>
        overlapping.some((inTool) => mergable(candidate, inTool))
      );
      if (overlappingIndex < 0) return []; // selected tool is not overlapping
      // use splice to remove the overlapping tool from the rest array
      overlapping.push(...rest.splice(overlappingIndex, 1));
    }
    return overlapping;
  });

  function mergeToolGroup(mergeGroup: Tool[]) {
    const firstTool = mergeGroup[0];

    const polygons = mergeGroup.map(toGeoJSON);
    if (polygons.some((p) => !p))
      throw new Error('Trying to merge invalid polygons');

    const [first, ...rest] = polygons as unknown as polygonClipping.Geom[];
    const merged = polygonClipping.union(first, ...rest);
    const { to3D } = getPlaneTransforms(firstTool.frameOfReference);
    const points = merged.flatMap((p) => p.flatMap((ring) => ring.map(to3D)));

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _, ...toolProps } = firstTool;
    const mergedTool = {
      ...toolProps,
      points,
    };
    toolAPI.addTool(mergedTool);
    mergeGroup.map(({ id }) => id).forEach(toolAPI.removeTool);
  }

  function mergeTools() {
    mergeToolGroup(mergeableTools.value);
  }

  function mergeWithOtherTools(id: ToolID) {
    const lastTool = toolAPI.toolByID.value[id];
    const olderTools = toolAPI.tools.value.filter(
      (tool) => tool !== lastTool && !tool.placing
    );
    if (!lastTool || olderTools.length === 0) return;
    const mergeable = olderTools.filter((older) => mergable(older, lastTool));
    if (mergeable.length === 0) return;
    mergeToolGroup([lastTool, ...mergeable]);
  }

  // --- serialization --- //

  function serialize(state: StateFile) {
    state.manifest.tools.polygons = toolAPI.serializeTools();
  }

  function deserialize(manifest: Manifest, dataIDMap: Record<string, string>) {
    toolAPI.deserializeTools(manifest.tools.polygons, dataIDMap);
  }

  return {
    ...toolAPI,
    getPoints,
    mergeableTools,
    mergeTools,
    mergeWithOtherTools,
    serialize,
    deserialize,
  };
});
