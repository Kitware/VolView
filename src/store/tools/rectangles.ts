import { defineStore } from 'pinia';
import { TOOL_COLORS } from '@/src/config';
import { Manifest, StateFile } from '@/src/io/state-file/schema';
import { Rectangle, RectangleID } from '@/src/types/rectangle';
import { useAnnotationTool } from './useAnnotationTool';

export type Tool = Rectangle;
export type ToolID = RectangleID;

const rectangleDefaults: Rectangle = {
  firstPoint: [0, 0, 0],
  secondPoint: [0, 0, 0],
  frameOfReference: {
    planeOrigin: [0, 0, 0],
    planeNormal: [1, 0, 0],
  },
  slice: -1,
  imageID: '',
  id: '' as ToolID,
  name: 'Rectangle',
  color: TOOL_COLORS[0],
  placing: false,
};

export const useRectangleStore = defineStore('rectangles', () => {
  const {
    serialize: serializeTools,
    deserialize: deserializeTools,
    ...toolStoreProps
  } = useAnnotationTool({
    toolDefaults: rectangleDefaults,
  });

  // --- serialization --- //

  function serialize(state: StateFile) {
    state.manifest.tools.rectangles = serializeTools();
  }

  function deserialize(manifest: Manifest, dataIDMap: Record<string, string>) {
    const rectanglesInState = manifest.tools.rectangles;
    deserializeTools(rectanglesInState, dataIDMap);
  }

  return {
    ...toolStoreProps,
    serialize,
    deserialize,
  };
});
