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

  // --- serialization --- //

  function serialize(state: StateFile) {
    state.manifest.tools.polygons = toolAPI.serializeTools();
  }

  function deserialize(manifest: Manifest, dataIDMap: Record<string, string>) {
    toolAPI.deserializeTools(manifest.tools.polygons, dataIDMap);
  }

  return {
    ...toolAPI,
    serialize,
    deserialize,
  };
});
