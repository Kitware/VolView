import { Ref, computed, ref } from 'vue';
import { watchCompare } from '@/src/utils/watchCompare';
import deepEqual from 'fast-deep-equal';

/**
 * Ensures that a Ref holds a stable reference by deep comparison.
 * @param sourceRef
 * @returns
 */
export function stableDeepRef<T>(sourceRef: Ref<T>) {
  const stableRef = ref<T>(sourceRef.value) as Ref<T>;
  watchCompare(
    sourceRef,
    (result) => {
      stableRef.value = result;
    },
    { compare: deepEqual }
  );

  return computed({
    get: () => stableRef.value,
    set: (v) => {
      sourceRef.value = v;
    },
  });
}
