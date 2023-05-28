import { computed } from 'vue';
import { defineStore } from 'pinia';
import { Vector3 } from '@kitware/vtk.js/types';
import { distance2BetweenPoints } from '@kitware/vtk.js/Common/Core/Math';

import { RULER_LABEL_DEFAULTS } from '@/src/config';
import { Manifest, StateFile } from '@/src/io/state-file/schema';

import { Ruler } from '../../types/ruler';
import { useAnnotationTool } from './useAnnotationTool';
import { ensureHash, parseLabelUrlParam } from './useLabels';

const rulerDefaults = {
  firstPoint: [0, 0, 0] as Vector3,
  secondPoint: [0, 0, 0] as Vector3,
  id: '',
  name: 'Ruler',
};

export const useRulerStore = defineStore('ruler', () => {
  type _This = ReturnType<typeof useRulerStore>;

  const initialLabels =
    parseLabelUrlParam<Ruler>('labels', {
      color: ensureHash,
    }) ?? RULER_LABEL_DEFAULTS;

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
