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

  type Polygon = (typeof toolAPI.tools.value)[number];
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
    const benchmark = selectedPolygons[0];
    const mergePossible = selectedPolygons.every(
      (polygon) =>
        polygon.label === benchmark.label &&
        polygon.slice === benchmark.slice &&
        polygon.frameOfReference === benchmark.frameOfReference
    );
    if (!mergePossible) return [];

    const { to2D } = getPlaneTransforms(selectedPolygons[0].frameOfReference);
    const toGeoJSON = (polygon: Polygon) => [polygon.points.map(to2D)];
    const polygonsOverlap = (a: Polygon, b: Polygon) => {
      return (
        polygonClipping.intersection(toGeoJSON(a), toGeoJSON(b)).length > 0
      );
    };
    const overlappingGroups = selectedPolygons
      .reduce((groups, candidate) => {
        const overlappingGroup = groups.find((set) =>
          set.some((group) => polygonsOverlap(group, candidate))
        );
        if (overlappingGroup) {
          overlappingGroup.push(candidate);
        } else {
          groups.push([candidate]);
        }
        return groups;
      }, [] as Array<Array<Polygon>>)
      .filter((group) => group.length > 1);

    return overlappingGroups;
  });

  function mergeTools() {
    mergeableTools.value.forEach((tools) => {
      const firstTool = tools[0];
      const { to2D, to3D } = getPlaneTransforms(firstTool.frameOfReference);

      const polygons = tools
        .map((tool) => tool.points)
        .map((points) => [points.map(to2D)]); // GeoJSON Polygon can have multiple rings so wrap in array

      const [first, ...rest] = polygons;
      const merged = polygonClipping.union(first, ...rest);
      const points = merged.flatMap((p) => p.flatMap((ring) => ring.map(to3D)));

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _, ...toolProps } = firstTool;
      const mergedTool = {
        ...toolProps,
        points,
      };
      toolAPI.addTool(mergedTool);
      tools.map(({ id }) => id).forEach(toolAPI.removeTool);
    });
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
    mergeableTools,
    getPoints,
    mergeTools,
    serialize,
    deserialize,
  };
});
