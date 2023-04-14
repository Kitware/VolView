import { computed, reactive, unref } from 'vue';
import { MaybeRef } from '@vueuse/core';

export function useDoubleRecord<V>() {
  type Map1 = Record<string, Record<string, V>>;
  type Map2 = Record<string, V>;
  const reactiveRoot = reactive<{ map: Map1 }>({
    map: {},
  });

  const _set = (k1: string, k2: string, v: V) => {
    if (!(k1 in reactiveRoot.map)) {
      reactiveRoot.map[k1] = reactive<Map2>({});
    }
    reactiveRoot.map[k1][k2] = v;
  };

  const get = (k1: string, k2: string) => {
    return reactiveRoot.map[k1]?.[k2] ?? undefined;
  };

  const getComputed = (
    k1: MaybeRef<string | null | undefined>,
    k2: MaybeRef<string | null | undefined>
  ) => {
    return computed(() => {
      const k1v = unref(k1);
      const k2v = unref(k2);
      const { map } = reactiveRoot;
      if (!k1v || !k2v) return undefined;
      return map[k1v]?.[k2v];
    });
  };

  const has = (k1: string, k2: string) => {
    const { map } = reactiveRoot;
    return k1 in map && k2 in map[k1];
  };

  const hasComputed = (
    k1: MaybeRef<string | null | undefined>,
    k2: MaybeRef<string | null | undefined>
  ) => {
    return computed(() => {
      const k1v = unref(k1);
      const k2v = unref(k2);
      const { map } = reactiveRoot;
      if (!k1v || !k2v) return undefined;
      return k1v in map && k2v in map[k1v];
    });
  };

  const _delete = (k1: string, k2: string) => {
    if (k1 in reactiveRoot.map) {
      delete reactiveRoot.map[k1][k2];
    }
  };

  const deleteFirstKey = (k1: string) => {
    delete reactiveRoot.map[k1];
  };

  const deleteSecondKey = (k2: string) => {
    Object.keys(reactiveRoot.map).forEach((k1) => _delete(k1, k2));
  };

  return {
    set: _set,
    get,
    getComputed,
    has,
    hasComputed,
    delete: _delete,
    deleteFirstKey,
    deleteSecondKey,
  };
}
