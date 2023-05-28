import { defineStore } from 'pinia';
import { Vector3 } from '@kitware/vtk.js/types';
import { RECTANGLE_LABEL_DEFAULTS } from '@/src/config';
import { Manifest, StateFile } from '@/src/io/state-file/schema';
import { Rectangle, RectangleID } from '@/src/types/rectangle';

import { useAnnotationTool } from './useAnnotationTool';
import { ensureHash, parseLabelUrlParam } from './useLabels';

const rectangleDefaults = {
  firstPoint: [0, 0, 0] as Vector3,
  secondPoint: [0, 0, 0] as Vector3,
  id: '' as RectangleID,
  name: 'Rectangle',
  fillColor: '#10000000',
};

export const useRectangleStore = defineStore('rectangles', () => {
  type _This = ReturnType<typeof useRectangleStore>;

  const initialLabels =
    parseLabelUrlParam<Rectangle>('rectangleLabels', {
      color: ensureHash,
      fillColor: ensureHash,
    }) ?? RECTANGLE_LABEL_DEFAULTS;

  const {
    serialize: serializeTools,
    deserialize: deserializeTools,
    ...toolStoreProps
  } = useAnnotationTool({
    toolDefaults: rectangleDefaults,
    initialLabels,
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
