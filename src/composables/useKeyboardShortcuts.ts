import { onKeyDown, onKeyStroke } from '@vueuse/core';

import useHistoryStore from '@/src/store/history';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { isDarwin } from '@/src/constants';
import { DEFAULT_KEYMAP } from '../config';
import { useToolStore } from '../store/tools';
import { Tools } from '../store/tools/types';
import { useRectangleStore } from '../store/tools/rectangles';
import { useRulerStore } from '../store/tools/rulers';
import { usePolygonStore } from '../store/tools/polygons';

const Keymap = DEFAULT_KEYMAP;

const isCtrlOrCmd = (ev: KeyboardEvent) => {
  return isDarwin ? ev.metaKey : ev.ctrlKey;
};

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

const undo = () => {
  const { currentImageID } = useCurrentImage();
  if (!currentImageID.value) return;
  useHistoryStore().undo({ datasetID: currentImageID.value });
};

const redo = () => {
  const { currentImageID } = useCurrentImage();
  if (!currentImageID.value) return;
  useHistoryStore().redo({ datasetID: currentImageID.value });
};

export function useKeyboardShortcuts() {
  onKeyDown(Keymap.DecrementLabel, () => applyLabelOffset(-1));
  onKeyDown(Keymap.IncrementLabel, () => applyLabelOffset(1));
  onKeyStroke(Keymap.UndoRedo, (ev) => {
    if (isCtrlOrCmd(ev)) {
      ev.preventDefault();
      if (ev.shiftKey) redo();
      else undo();
    }
  });
}
