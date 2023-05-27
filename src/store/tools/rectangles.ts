import { defineStore } from 'pinia';
import { Vector3 } from '@kitware/vtk.js/types';
import { TOOL_COLORS } from '@/src/config';
import { Manifest, StateFile } from '@/src/io/state-file/schema';
import { Rectangle, RectangleID } from '@/src/types/rectangle';

import vtkURLExtract from '@kitware/vtk.js/Common/Core/URLExtract';
import { UrlParams } from '@vueuse/core';
import { chunk } from '@/src/utils';

import { useAnnotationTool } from './useAnnotationTool';
import { Labels } from './useLabels';

const rectangleDefaults = {
  firstPoint: [0, 0, 0] as Vector3,
  secondPoint: [0, 0, 0] as Vector3,
  id: '' as RectangleID,
  name: 'Rectangle',
  color: TOOL_COLORS[0],
  fillColor: '#10000000',
};

const ensureHash = (color: string | number) => {
  const colorStr = color.toString();
  if (colorStr.startsWith('#')) return colorStr;
  return `#${color}`;
};

const parseLabelUrlParam = () => {
  const urlParams = vtkURLExtract.extractURLParameters() as UrlParams;
  const rawLabels = urlParams.rectangleLabels;
  if (!rawLabels || !Array.isArray(rawLabels)) return {};

  return chunk(rawLabels, 3)
    .map(([name, color, fillColor]) => ({
      name,
      color: ensureHash(color),
      fillColor: ensureHash(fillColor),
    }))
    .reduce(
      (labels, { name, color, fillColor }) => ({
        ...labels,
        [name]: { color, fillColor },
      }),
      {} as Labels<Rectangle>
    );
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
