import { ref, watch } from 'vue';
import { useMagicKeys, whenever } from '@vueuse/core';

import { getEntries } from '../utils';
import { ACTION_TO_KEY } from '../config';
import { ACTION_TO_FUNC } from './actions';

export const actionToKey = ref(ACTION_TO_KEY);

export function useKeyboardShortcuts() {
  const keys = useMagicKeys();
  let unwatchFuncs = [] as Array<ReturnType<typeof whenever>>;

  watch(
    actionToKey,
    (actionMap) => {
      unwatchFuncs.forEach((unwatch) => unwatch());

      unwatchFuncs = getEntries(actionMap).map(([action, key]) => {
        return whenever(keys[key], () => {
          // basic detection for exact modifier match
          if (keys.current.size === key.split('+').length) {
            ACTION_TO_FUNC[action]();
          }
        });
      });
    },
    { immediate: true, deep: true }
  );
}
