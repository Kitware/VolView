import type { Vector3 } from '@kitware/vtk.js/types';
import { POLYGON_LABEL_DEFAULTS } from '@/src/config';
import { Manifest, StateFile } from '@/src/io/state-file/schema';
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
    const points = tools
      .map((id) => toolAPI.toolByID.value[id])
      .reduce((allPoints, tool) => {
        return allPoints.concat(tool.points);
      }, [] as Array<Vector3>);
    toolAPI.updateTool(tools[0], { points });
    tools.slice(1).forEach(toolAPI.removeTool);
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
