import { ref, Ref, UnwrapRef, watch, WatchOptions } from 'vue';

/**
 * immediate: sync from sync state to valueRef immediately.
 */
type SyncOptions = {
  immediate: boolean;
  watchOptions?: WatchOptions;
};

/**
 * Only tested on primitive values.
 */
export function createPrimitiveSyncContext<T, K>(initialState: T) {
  const states = new Map<K, Ref<UnwrapRef<T>>>();
  const usage = new Map<K, number>();

  const register = (key: K, valueRef: Ref<T>, options?: SyncOptions) => {
    if (!states.has(key)) {
      states.set(key, ref(initialState));
    }
    const state = states.get(key)!;
    usage.set(key, 1 + (usage.get(key) ?? 0));

    const stopTo = watch(
      valueRef,
      (newValue) => {
        if (newValue !== state.value) {
          state.value = newValue as UnwrapRef<T>;
        }
      },
      {
        flush: 'sync',
        immediate: true,
        ...options?.watchOptions,
      }
    );

    const stopFrom = watch(
      state,
      (newState) => {
        if (newState !== valueRef.value) {
          /* eslint-disable-next-line no-param-reassign */
          valueRef.value = newState as T;
        }
      },
      {
        flush: 'sync',
        immediate: true,
        ...options?.watchOptions,
      }
    );

    return () => {
      stopTo();
      stopFrom();

      usage.set(key, usage.get(key)! - 1);
      if (usage.get(key) === 0) {
        usage.delete(key);
        states.delete(key);
      }
    };
  };

  const useSync = (key: Ref<K>, valueRef: Ref<T>, options?: SyncOptions) => {
    let cleanup: (() => void) | null = null;
    watch(
      key,
      (newKey) => {
        if (cleanup) cleanup();
        cleanup = register(newKey, valueRef, options);
      },
      {
        flush: 'sync',
        immediate: true,
      }
    );
  };

  return useSync;
}
