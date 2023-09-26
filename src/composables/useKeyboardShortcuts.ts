import { ref, watch } from 'vue';
import { useMagicKeys, whenever } from '@vueuse/core';

import { DECREMENT_LABEL_KEY, INCREMENT_LABEL_KEY } from '../config';
import { useToolStore } from '../store/tools';
import { Tools } from '../store/tools/types';
import { useRectangleStore } from '../store/tools/rectangles';
import { useRulerStore } from '../store/tools/rulers';
import { usePolygonStore } from '../store/tools/polygons';
import { getEntries } from '../utils';

const applyLabelOffset = (offset: number) => {
  const toolToStore = {
    [Tools.Rectangle]: useRectangleStore(),
    [Tools.Ruler]: useRulerStore(),
    [Tools.Polygon]: usePolygonStore(),
  };
  const toolStore = useToolStore();

  // @ts-ignore - toolToStore may not have keys of all tools
  const activeToolStore = toolToStore[toolStore.currentTool];
  if (!activeToolStore) return;

  const labels = Object.entries(activeToolStore.labels);
  const activeLabelIndex = labels.findIndex(
    ([name]) => name === activeToolStore.activeLabel
  );

  const [nextLabel] = labels.at((activeLabelIndex + offset) % labels.length)!;
  activeToolStore.setActiveLabel(nextLabel);
};

const actionToFunc = {
  'decrement-label': () => applyLabelOffset(-1),
  'increment-label': () => applyLabelOffset(1),
};

const actionToKey = ref({
  'decrement-label': DECREMENT_LABEL_KEY,
  'increment-label': INCREMENT_LABEL_KEY,
});

export function useKeyboardShortcuts() {
  const keys = useMagicKeys();
  const unwatchFuncs = ref([] as Array<ReturnType<typeof whenever>>);

  watch(
    actionToKey,
    (actionMap) => {
      unwatchFuncs.value.forEach((unwatch) => unwatch());

      unwatchFuncs.value = getEntries(actionMap).map(([action, key]) => {
        return whenever(keys[key], actionToFunc[action]);
      });
    },
    { immediate: true, deep: true }
  );
}
