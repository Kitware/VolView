import polybool, { Polygon as LibPolygon } from '@velipso/polybool';
import type { Vector3, Vector2 } from '@kitware/vtk.js/types';
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

  const toPolyLibStructure = (polygon: Tool) => {
    const { to2D } = getPlaneTransforms(polygon.frameOfReference);
    if (polygon.points.length === 0) return undefined; // empty polygons are invalid
    return {
      regions: [polygon.points.map(to2D)],
      inverted: false,
    };
  };

  const polygonsOverlap = (a: Tool, b: Tool) => {
    const [aGeo, bGeo] = [a, b].map(toPolyLibStructure);
    if (!aGeo || !bGeo) return false;
    return polybool.intersect(aGeo, bGeo).regions.length > 0;
  };

  const pointEquals = (a: Vector2, b: Vector2) =>
    a[0] === b[0] && a[1] === b[1];

  // After union, regions will have shared points because we require overlap to union.
  // Create one region/ring by splicing in the next region at the common point.
  const mergeRegions = (regions: Array<Array<Vector2>>) => {
    const [mergedRegion, ...candidates] = regions;

    while (candidates.length > 0) {
      let regionIndex = 0;
      let mergedCommonPointIndex = 0;
      let candidateCommonPointIndex = 0;
      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        let candidatePointIndex = 0;
        const commonPointIndex = mergedRegion.findIndex((point) =>
          candidate.some((nextPoint, index) => {
            candidatePointIndex = index;
            return pointEquals(point, nextPoint);
          })
        );
        if (commonPointIndex !== -1) {
          regionIndex = i;
          mergedCommonPointIndex = commonPointIndex;
          candidateCommonPointIndex = candidatePointIndex;
          break;
        }
      }
      const [toMerge] = candidates.splice(regionIndex, 1);
      const oldStart = toMerge.splice(0, candidateCommonPointIndex);
      const startWithCommonPoint = [...toMerge, ...oldStart];
      mergedRegion.splice(mergedCommonPointIndex, 0, ...startWithCommonPoint);
    }

    return mergedRegion;
  };

  const mergePolygons = (polygons: Array<Tool>) => {
    const libPolygons = polygons.map(toPolyLibStructure) as Array<LibPolygon>;
    if (libPolygons.some((p) => p === undefined))
      throw new Error('Trying to merge invalid polygons');

    let segments = polybool.segments(libPolygons[0]);
    for (let i = 1; i < libPolygons.length; i++) {
      const seg2 = polybool.segments(libPolygons[i]);
      const comb = polybool.combine(segments, seg2);
      segments = polybool.selectUnion(comb);
    }
    const unionPoly = polybool.polygon(segments);

    const firstTool = polygons[0];
    const { to3D } = getPlaneTransforms(firstTool.frameOfReference);

    const points = mergeRegions(unionPoly.regions).map(to3D);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _, ...toolProps } = polygons[0];
    const mergedTool = {
      ...toolProps,
      points,
    };
    return mergedTool;
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

  function mergeTools(mergeGroup: Tool[]) {
    const mergedTool = mergePolygons(mergeGroup);
    toolAPI.addTool(mergedTool);
    mergeGroup.map(({ id }) => id).forEach(toolAPI.removeTool);
  }

  function mergeSelectedTools() {
    mergeTools(mergeableTools.value);
  }

  function mergeWithOtherTools(id: ToolID) {
    const lastTool = toolAPI.toolByID.value[id];
    const olderTools = toolAPI.tools.value.filter(
      (tool) => tool !== lastTool && !tool.placing
    );
    if (!lastTool || olderTools.length === 0) return;
    const mergeable = olderTools.filter((older) => mergable(older, lastTool));
    if (mergeable.length === 0) return;
    mergeTools([lastTool, ...mergeable]);
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
    mergeSelectedTools,
    mergeWithOtherTools,
    serialize,
    deserialize,
  };
});
