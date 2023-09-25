import { defineStore } from 'pinia';
import type { Vector3 } from '@kitware/vtk.js/types';
import { POLYGON_LABEL_DEFAULTS } from '@/src/config';
import { Manifest, StateFile } from '@/src/io/state-file/schema';
import { ToolID } from '@/src/types/annotation-tool';

import { useAnnotationTool } from './useAnnotationTool';

const toolDefaults = () => ({
  points: [] as Array<Vector3>,
  id: '' as ToolID,
  name: 'Polygon',
});

export const usePolygonStore = defineStore('polygon', () => {
  type _This = ReturnType<typeof usePolygonStore>;

  const {
    serialize: serializeTool,
    deserialize: deserializeTool,
    ...toolStoreProps
  } = useAnnotationTool({
    toolDefaults,
    initialLabels: POLYGON_LABEL_DEFAULTS,
  });

  // --- serialization --- //

  function serialize(state: StateFile) {
    state.manifest.tools.polygons = serializeTool();
  }

  function deserialize(
    this: _This,
    manifest: Manifest,
    dataIDMap: Record<string, string>
  ) {
    deserializeTool.call(this, manifest.tools.polygons, dataIDMap);
  }

  return {
    ...toolStoreProps,
    serialize,
    deserialize,
  };
});
