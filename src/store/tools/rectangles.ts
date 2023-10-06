import { defineAnnotationToolStore } from '@/src/utils/defineAnnotationToolStore';
import type { Vector3 } from '@kitware/vtk.js/types';
import { Manifest, StateFile } from '@/src/io/state-file/schema';
import { RECTANGLE_LABEL_DEFAULTS } from '@/src/config';
import { ToolID } from '@/src/types/annotation-tool';

import { useAnnotationTool } from './useAnnotationTool';

const rectangleDefaults = () => ({
  firstPoint: [0, 0, 0] as Vector3,
  secondPoint: [0, 0, 0] as Vector3,
  id: '' as ToolID,
  name: 'Rectangle',
  fillColor: 'transparent',
});

const newLabelDefault = {
  fillColor: 'transparent',
};

export const useRectangleStore = defineAnnotationToolStore('rectangles', () => {
  const toolAPI = useAnnotationTool({
    toolDefaults: rectangleDefaults,
    initialLabels: RECTANGLE_LABEL_DEFAULTS,
    newLabelDefault,
  });

  function getPoints(id: ToolID) {
    const tool = toolAPI.toolByID.value[id];
    return [tool.firstPoint, tool.secondPoint];
  }

  // --- serialization --- //

  function serialize(state: StateFile) {
    state.manifest.tools.rectangles = toolAPI.serializeTools();
  }

  function deserialize(manifest: Manifest, dataIDMap: Record<string, string>) {
    toolAPI.deserializeTools(manifest.tools.rectangles, dataIDMap);
  }

  return {
    ...toolAPI,
    getPoints,
    serialize,
    deserialize,
  };
});
