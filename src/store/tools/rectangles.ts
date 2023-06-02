import { defineStore } from 'pinia';
import { Vector3 } from '@kitware/vtk.js/types';
import { Manifest, StateFile } from '@/src/io/state-file/schema';
import { RECTANGLE_LABEL_DEFAULTS } from '@/src/config';
import { RectangleID } from '@/src/types/rectangle';

import { useAnnotationTool } from './useAnnotationTool';

const rectangleDefaults = {
  firstPoint: [0, 0, 0] as Vector3,
  secondPoint: [0, 0, 0] as Vector3,
  id: '' as RectangleID,
  name: 'Rectangle',
  fillColor: 'transparent',
};

export const useRectangleStore = defineStore('rectangles', () => {
  type _This = ReturnType<typeof useRectangleStore>;

  const {
    serialize: serializeTools,
    deserialize: deserializeTools,
    ...toolStoreProps
  } = useAnnotationTool({
    toolDefaults: rectangleDefaults,
    initialLabels: RECTANGLE_LABEL_DEFAULTS,
  });

  // --- serialization --- //

  function serialize(state: StateFile) {
    state.manifest.tools.rectangles = serializeTools();
  }

  function deserialize(
    this: _This,
    manifest: Manifest,
    dataIDMap: Record<string, string>
  ) {
    deserializeTools.call(this, manifest.tools.rectangles ?? [], dataIDMap);
  }

  return {
    ...toolStoreProps,
    serialize,
    deserialize,
  };
});
