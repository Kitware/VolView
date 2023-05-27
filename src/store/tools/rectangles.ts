import { defineStore } from 'pinia';
import { TOOL_COLORS } from '@/src/config';
import { Manifest, StateFile } from '@/src/io/state-file/schema';
import { Rectangle, RectangleID } from '@/src/types/rectangle';

import vtkURLExtract from '@kitware/vtk.js/Common/Core/URLExtract';
import { UrlParams } from '@vueuse/core';
import { chunk } from '@/src/utils';

import { useAnnotationTool } from './useAnnotationTool';
import { Labels } from './useLabels';

const rectangleDefaults: Rectangle = {
  firstPoint: [0, 0, 0],
  secondPoint: [0, 0, 0],
  frameOfReference: {
    planeOrigin: [0, 0, 0],
    planeNormal: [1, 0, 0],
  },
  slice: -1,
  imageID: '',
  id: '' as RectangleID,
  name: 'Rectangle',
  color: TOOL_COLORS[0],
  labelProps: ['color'],
  placing: false,
};

const ensureHash = (color: string | number) => {
  const colorStr = color.toString();
  if (colorStr.startsWith('#')) return colorStr;
  return `#${color}`;
};

const parseLabelUrlParam = () => {
  const urlParams = vtkURLExtract.extractURLParameters() as UrlParams;
  const rawLabels = urlParams.labels;
  if (!rawLabels || !Array.isArray(rawLabels)) return {};

  const labelMap = chunk(rawLabels, 2)
    .map(([name, color]) => ({
      name,
      color: ensureHash(color),
    }))
    .reduce(
      (labels, { name, color }) => ({
        ...labels,
        [name]: { color },
      }),
      {} as Labels<Rectangle>
    );

  return labelMap;
};

export const useRectangleStore = defineStore('rectangles', () => {
  type _This = ReturnType<typeof useRectangleStore>;

  const initialLabels = parseLabelUrlParam();
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
