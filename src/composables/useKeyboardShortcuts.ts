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
        const individualKeys = key.split('+');
        const lastKey = individualKeys[individualKeys.length - 1];

        return whenever(keys[key], () => {
          const shiftPressed = keys.current.has('shift');
          const lastPressedKey = Array.from(keys.current).pop();
          const currentKeyWithCase = shiftPressed
            ? lastPressedKey?.toUpperCase() ?? lastPressedKey
            : lastPressedKey;

          // keyCountMatches checks for exact modifier match
          const keyCountMatches = keys.current.size === individualKeys.length;
          const lastKeyMatches = lastKey === currentKeyWithCase;
          const shiftCaseMatches =
            shiftPressed &&
            keys.current.size - 1 === individualKeys.length &&
            lastKeyMatches;

          if ((keyCountMatches && lastKeyMatches) || shiftCaseMatches) {
            ACTION_TO_FUNC[action]();
          }
        });
      });
    },
    { immediate: true, deep: true }
  );
}
