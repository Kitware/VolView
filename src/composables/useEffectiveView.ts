import { computed, MaybeRef, unref } from 'vue';
import { getEffectiveView } from '@/src/core/views/effectiveView';

export function useEffectiveView(viewID: MaybeRef<string>) {
  return computed(() => getEffectiveView(unref(viewID)));
}
