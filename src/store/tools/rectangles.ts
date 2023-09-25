import { defineStore } from 'pinia';
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

export const useRectangleStore = defineStore('rectangles', () => {
  type _This = ReturnType<typeof useRectangleStore>;

  const {
    serialize: serializeTool,
    deserialize: deserializeTool,
    ...toolStoreProps
  } = useAnnotationTool({
    toolDefaults: rectangleDefaults,
    initialLabels: RECTANGLE_LABEL_DEFAULTS,
    newLabelDefault,
  });

  // --- serialization --- //

  function serialize(state: StateFile) {
    state.manifest.tools.rectangles = serializeTool();
  }

  function deserialize(
    this: _This,
    manifest: Manifest,
    dataIDMap: Record<string, string>
  ) {
    deserializeTool.call(this, manifest.tools.rectangles, dataIDMap);
  }

  return {
    ...toolStoreProps,
    serialize,
    deserialize,
  };
});
