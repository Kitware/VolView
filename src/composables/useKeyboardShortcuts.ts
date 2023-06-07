import { onMounted, onUnmounted } from 'vue';

import { DECREMENT_LABEL_KEY, INCREMENT_LABEL_KEY } from '../config';
import { useToolStore } from '../store/tools';
import { Tools } from '../store/tools/types';
import { useRectangleStore } from '../store/tools/rectangles';
import { useRulerStore } from '../store/tools/rulers';

type AnnotationToolStore =
  | ReturnType<typeof useRectangleStore>
  | ReturnType<typeof useRulerStore>;

const handleLabelSection = (event: KeyboardEvent) => {
  const toolToStore = {
    [Tools.Rectangle]: useRectangleStore(),
    [Tools.Ruler]: useRulerStore(),
  };
  const toolStore = useToolStore();

  // @ts-ignore - map may not have all keys of tools
  const activeToolStore = toolToStore[toolStore.currentTool] as
    | AnnotationToolStore
    | undefined;
  if (!activeToolStore) return;

  let offset = 0;
  if (event.key === DECREMENT_LABEL_KEY) {
    offset = -1;
  }
  if (event.key === INCREMENT_LABEL_KEY) {
    offset = 1;
  }

  const labels = Object.entries(activeToolStore.labels);
  const activeLabelIndex = labels.findIndex(
    ([name]) => name === activeToolStore.activeLabel
  );

  const [nextLabel] = labels.at((activeLabelIndex + offset) % labels.length)!;
  activeToolStore.setActiveLabel(nextLabel);
};

export function useKeyboardShortcuts() {
  const handleKeyDown = (event: KeyboardEvent) => {
    handleLabelSection(event);
  };

  onMounted(() => {
    window.addEventListener('keydown', handleKeyDown);
  });
  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyDown);
  });
}
