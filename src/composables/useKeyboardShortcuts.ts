import { onKeyDown } from '@vueuse/core';

import { DECREMENT_LABEL_KEY, INCREMENT_LABEL_KEY } from '../config';
import { useToolStore } from '../store/tools';
import { Tools } from '../store/tools/types';
import { useRectangleStore } from '../store/tools/rectangles';
import { useRulerStore } from '../store/tools/rulers';
import { usePolygonStore } from '../store/tools/polygons';

const applyLabelOffset = (offset: number) => {
  const toolToStore = {
    [Tools.Rectangle]: useRectangleStore(),
    [Tools.Ruler]: useRulerStore(),
    [Tools.Polygon]: usePolygonStore(),
  };
  const toolStore = useToolStore();

  // @ts-ignore - map may not have all keys of tools
  const activeToolStore = toolToStore[toolStore.currentTool];
  if (!activeToolStore) return;

  const labels = Object.entries(activeToolStore.labels);
  const activeLabelIndex = labels.findIndex(
    ([name]) => name === activeToolStore.activeLabel
  );

  const [nextLabel] = labels.at((activeLabelIndex + offset) % labels.length)!;
  activeToolStore.setActiveLabel(nextLabel);
};

export function useKeyboardShortcuts() {
  onKeyDown(DECREMENT_LABEL_KEY, () => applyLabelOffset(-1));
  onKeyDown(INCREMENT_LABEL_KEY, () => applyLabelOffset(1));
}
