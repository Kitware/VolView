import { computed, inject } from '@vue/composition-api';

const defaultKey = 'Store';

export function useStore(key = defaultKey) {
  return inject(key ?? defaultKey);
}

/**
 *
 * @param {{ [name: string]: Function}} computedFns
 */
export function useComputedState(computedFns) {
  const store = useStore();
  return Object.entries(computedFns).reduce(
    (acc, [name, compFn]) => ({
      ...acc,
      [name]: computed(() => compFn(store.state, store.getters)),
    }),
    {}
  );
}
