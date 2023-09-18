import { useDebounceFn } from '@vueuse/core';
import { ref } from 'vue';

// reset: isSet = false immediately. After delay, isSet = true
export const usePopperState = (delay: number) => {
  const isSet = ref(true);

  const delayedSet = useDebounceFn(() => {
    isSet.value = true;
  }, delay);

  const reset = () => {
    isSet.value = false;
    delayedSet();
  };

  return { isSet, reset };
};
