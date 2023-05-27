import { computed } from 'vue';
import { UrlParams } from '@vueuse/core';
import { defineStore } from 'pinia';
import vtkURLExtract from '@kitware/vtk.js/Common/Core/URLExtract';
import { Vector3 } from '@kitware/vtk.js/types';
import { distance2BetweenPoints } from '@kitware/vtk.js/Common/Core/Math';

import { Manifest, StateFile } from '@/src/io/state-file/schema';
import { chunk } from '@/src/utils';

import { Ruler } from '../../types/ruler';
import { useAnnotationTool } from './useAnnotationTool';
import { Labels } from './useLabels';

const rulerDefaults = {
  firstPoint: [0, 0, 0] as Vector3,
  secondPoint: [0, 0, 0] as Vector3,
  id: '',
  name: 'Ruler',
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

  return chunk(rawLabels, 2)
    .map(([name, color]) => ({
      name,
      color: ensureHash(color),
    }))
    .reduce(
      (labels, { name, color }) => ({
        ...labels,
        [name]: { color },
      }),
      {} as Labels<Ruler>
    );
};

export const useRulerStore = defineStore('ruler', () => {
  type _This = ReturnType<typeof useRulerStore>;

  const initialLabels = parseLabelUrlParam();

  const {
    toolIDs: rulerIDs,
    toolByID: rulerByID,
    tools: rulers,
    addTool: addRuler,
    updateTool: updateRuler,
    removeTool: removeRuler,
    jumpToTool: jumpToRuler,
    serialize: serializeTools,
    deserialize: deserializeTools,
    activateTool,
    deactivateTool,
    ...rest // label tools
  } = useAnnotationTool({
    toolDefaults: rulerDefaults,
    initialLabels,
  });

  const lengthByID = computed<Record<string, number>>(() => {
    const byID = rulerByID.value;
    return rulerIDs.value.reduce((lengths, id) => {
      const { firstPoint, secondPoint } = byID[id];
      return Object.assign(lengths, {
        [id]: Math.sqrt(distance2BetweenPoints(firstPoint, secondPoint)),
      });
    }, {});
  });

  // --- serialization --- //

  function serialize(state: StateFile) {
    state.manifest.tools.rulers = serializeTools();
  }

  function deserialize(
    this: _This,
    manifest: Manifest,
    dataIDMap: Record<string, string>
  ) {
    deserializeTools.call(this, manifest.tools.rulers, dataIDMap);
  }

  return {
    ...rest,
    rulerIDs,
    rulerByID,
    rulers,
    lengthByID,
    addRuler,
    updateRuler,
    removeRuler,
    jumpToRuler,
    serialize,
    deserialize,
    activateTool,
    deactivateTool,
  };
});
