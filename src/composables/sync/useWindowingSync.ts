import { WindowLevelConfig } from '@/src/store/view-configs/types';
import { computed, Ref, triggerRef, WritableComputedRef } from 'vue';
import { createPrimitiveSyncContext } from './createPrimitiveSyncContext';

function generateComputed(
  source: WritableComputedRef<WindowLevelConfig | null>,
  prop: keyof WindowLevelConfig
) {
  return computed({
    get: () => source.value?.[prop] || null,
    set: (newValue) => {
      if (source.value && newValue != null) {
        /* eslint-disable no-param-reassign */
        source.value = {
          ...source.value,
          [prop]: newValue,
        };
      }
    },
  });
}

const useLevelSync = createPrimitiveSyncContext<number | null, string | null>(
  0
);
const useWidthSync = createPrimitiveSyncContext<number | null, string | null>(
  0
);

export function useWindowingSync(
  dataID: Ref<string | null>,
  source: WritableComputedRef<WindowLevelConfig | null>
) {
  const level = generateComputed(source, 'level');
  const width = generateComputed(source, 'width');

  // not 100% sure why, but this triggers tracking.
  triggerRef(level);
  triggerRef(width);

  useLevelSync(dataID, level);
  useWidthSync(dataID, width);
}
