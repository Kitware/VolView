import { computed } from 'vue';
import { defineStore } from 'pinia';
import { distance2BetweenPoints } from '@kitware/vtk.js/Common/Core/Math';
import { TOOL_COLORS } from '@/src/config';
import { Manifest, StateFile } from '@/src/io/state-file/schema';
import { Ruler } from '../../types/ruler';
import { useAnnotationTool } from './useAnnotationTool';

const rulerDefaults: Ruler = {
  firstPoint: [0, 0, 0],
  secondPoint: [0, 0, 0],
  frameOfReference: {
    planeOrigin: [0, 0, 0],
    planeNormal: [1, 0, 0],
  },
  slice: -1,
  imageID: '',
  id: '',
  name: 'Ruler',
  color: TOOL_COLORS[0],
  placing: false,
};

export const useRulerStore = defineStore('ruler', () => {
  type _This = ReturnType<typeof useRulerStore>;

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
