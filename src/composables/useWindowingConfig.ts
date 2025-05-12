import useWindowingStore from '@/src/store/view-configs/windowing';
import { Maybe } from '@/src/types';
import type { Vector2 } from '@kitware/vtk.js/types';
import { MaybeRef, unref, computed } from 'vue';

export function useWindowingConfig(
  viewID: MaybeRef<string>,
  imageID: MaybeRef<Maybe<string>>
) {
  const store = useWindowingStore();
  const config = computed(() => store.getConfig(unref(viewID), unref(imageID)));

  const generateComputed = (prop: 'width' | 'level') => {
    return computed({
      get: () => config.value?.[prop] ?? 0,
      set: (val) => {
        const imageIdVal = unref(imageID);
        if (!imageIdVal || val == null) return;
        store.updateConfig(unref(viewID), imageIdVal, { [prop]: val }, true);
      },
    });
  };

  const range = computed((): Vector2 => {
    const { min, max } = config.value ?? {};
    if (min == null || max == null) return [0, 1];
    return [min, max];
  });

  return {
    config,
    width: generateComputed('width'),
    level: generateComputed('level'),
    range,
  };
}
