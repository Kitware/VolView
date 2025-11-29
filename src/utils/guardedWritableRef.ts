import { Ref, computed } from 'vue';

export function guardedWritableRef<T>(
  obj: Ref<T>,
  accept: (incoming: T, current: T) => boolean
) {
  return computed({
    get: () => obj.value,
    set: (v) => {
      if (accept(v, obj.value)) {
        obj.value = v;
      }
    },
  });
}
