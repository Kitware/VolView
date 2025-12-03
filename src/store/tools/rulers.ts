import { computed } from 'vue';
import { defineAnnotationToolStore } from '@/src/utils/defineAnnotationToolStore';
import type { Vector3 } from '@kitware/vtk.js/types';
import { distance2BetweenPoints } from '@kitware/vtk.js/Common/Core/Math';
import { ToolID } from '@/src/types/annotation-tool';

import { RULER_LABEL_DEFAULTS } from '@/src/config';
import { Manifest, StateFile } from '@/src/io/state-file/schema';

import { useAnnotationTool } from './useAnnotationTool';

const rulerDefaults = () => ({
  firstPoint: [0, 0, 0] as Vector3,
  secondPoint: [0, 0, 0] as Vector3,
  id: '',
  name: 'Ruler',
});

export const useRulerStore = defineAnnotationToolStore('ruler', () => {
  const annotationTool = useAnnotationTool({
    toolDefaults: rulerDefaults,
    initialLabels: RULER_LABEL_DEFAULTS,
  });

  // prefix some props with ruler
  const {
    toolIDs: rulerIDs,
    toolByID: rulerByID,
    tools: rulers,
    addTool: addRuler,
    updateTool: updateRuler,
    removeTool: removeRuler,
    jumpToTool: jumpToRuler,
    serializeTools,
    deserializeTools,
  } = annotationTool;

  const lengthByID = computed<Record<string, number>>(() => {
    const byID = rulerByID.value;
    return rulerIDs.value.reduce((lengths, id) => {
      const { firstPoint, secondPoint } = byID[id];
      return Object.assign(lengths, {
        [id]: Math.sqrt(distance2BetweenPoints(firstPoint, secondPoint)),
      });
    }, {});
  });

  function getPoints(id: ToolID) {
    const tool = annotationTool.toolByID.value[id];
    return [tool.firstPoint, tool.secondPoint];
  }

  // --- serialization --- //

  function serialize(state: StateFile) {
    if (!state.manifest.tools) return;
    state.manifest.tools.rulers = serializeTools();
  }

  function deserialize(manifest: Manifest, dataIDMap: Record<string, string>) {
    deserializeTools(manifest.tools?.rulers, dataIDMap);
  }

  return {
    ...annotationTool, // support useAnnotationTool interface (for MeasurementsToolList)
    rulerIDs,
    rulerByID,
    rulers,
    lengthByID,
    addRuler,
    updateRuler,
    removeRuler,
    jumpToRuler,
    getPoints,
    serialize,
    deserialize,
  };
});
