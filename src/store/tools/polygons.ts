import * as polygonClipping from 'polyclip-ts';
import type { Vector3 } from '@kitware/vtk.js/types';
import { POLYGON_LABEL_DEFAULTS } from '@/src/config';
import { Manifest, StateFile } from '@/src/io/state-file/schema';
import { toFromPlane } from '@/src/utils/frameOfReference';
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

  function mergeTools(tools: Array<ToolID>) {
    const firstTool = toolAPI.toolByID.value[tools[0]];
    const { to2D, to3D } = toFromPlane(firstTool.frameOfReference);

    const polygons = tools
      .map((id) => toolAPI.toolByID.value[id].points)
      .map((points) => points.map(to2D));

    const merged = polygonClipping.union(
      [polygons[0]], // GeoJSON Polygon can have multiple rings so wrap in array
      ...polygons.slice(1).map((p) => [p])
    );
    const points = merged.flatMap((p) => p.flatMap((ring) => ring.map(to3D)));

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _, ...toolProps } = firstTool;
    const mergedTool = {
      ...toolProps,
      points,
    };
    toolAPI.addTool(mergedTool);
    tools.forEach(toolAPI.removeTool);
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
    mergeTools,
    serialize,
    deserialize,
  };
});
