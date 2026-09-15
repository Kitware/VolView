import { defineAnnotationToolStore } from '@/src/utils/defineAnnotationToolStore';
import type { Vector3 } from '@kitware/vtk.js/types';
import { Manifest, StateFile } from '@/src/io/state-file/schema';
import { ToolID } from '@/src/types/annotation-tool';

import { useSegmentStore } from '@/src/segmentation/segments';
import {
  declareAnnotationToolManifestRefs,
  useAnnotationTool,
} from './useAnnotationTool';

declareAnnotationToolManifestRefs('rectangles');

const rectangleDefaults = () => ({
  firstPoint: [0, 0, 0] as Vector3,
  secondPoint: [0, 0, 0] as Vector3,
  id: '' as ToolID,
  name: 'Rectangle',
  fillColor: 'transparent',
});

export const useRectangleStore = defineAnnotationToolStore('rectangles', () => {
  const toolAPI = useAnnotationTool({
    toolDefaults: rectangleDefaults,
    segments: () => useSegmentStore().segments,
    manifestKey: 'rectangles',
  });

  function getPoints(id: ToolID) {
    const tool = toolAPI.toolByID.value[id];
    return [tool.firstPoint, tool.secondPoint];
  }

  // --- serialization --- //

  function serialize(state: StateFile) {
    if (!state.manifest.tools) return;
    state.manifest.tools.rectangles = toolAPI.serializeTools();
  }

  function deserialize(
    manifest: Manifest,
    dataIDMap: Record<string, string>,
    segmentIdMap: Record<string, string> = {}
  ) {
    toolAPI.deserializeTools(
      manifest.tools?.rectangles,
      dataIDMap,
      segmentIdMap
    );
  }

  return {
    ...toolAPI,
    getPoints,
    serialize,
    deserialize,
  };
});
