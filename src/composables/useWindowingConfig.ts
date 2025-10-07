import { useWindowingStore } from '@/src/store/view-configs/windowing';
import { Maybe } from '@/src/types';
import type { Vector2 } from '@kitware/vtk.js/types';
import { MaybeRef, unref, computed } from 'vue';
import { useImageStatsStore } from '@/src/store/image-stats';

export function useWindowingConfig(
  viewID: MaybeRef<string>,
  imageID: MaybeRef<Maybe<string>>
) {
  const store = useWindowingStore();
  const imageStatsStore = useImageStatsStore();
  const config = computed(() => {
    const imageIdVal = unref(imageID);
    if (!imageIdVal) return undefined;
    const viewIdVal = unref(viewID);
    if (!viewIdVal) return undefined;
    return store.getConfig(viewIdVal, imageIdVal);
  });

  const generateComputed = (prop: 'width' | 'level') => {
    // show all-black image with W/L of (1, 2^32-1) until slices load in and we get a valid window/level
    const defaultValue = prop === 'width' ? 1 : 2 ** 32 - 1;
    return computed({
      get: () => {
        return config.value?.[prop] ?? defaultValue;
      },
      set: (val) => {
        const imageIdVal = unref(imageID);
        if (!imageIdVal || val == null) return;
        store.updateConfig(unref(viewID), imageIdVal, { [prop]: val }, true);
      },
    });
  };

  const range = computed((): Vector2 => {
    const imageIdVal = unref(imageID);
    if (!imageIdVal) return [0, 1];
    const stats = imageStatsStore.stats[imageIdVal];
    if (!stats || stats.scalarMin == null || stats.scalarMax == null)
      return [0, 1];
    return [stats.scalarMin, stats.scalarMax];
  });

  return {
    config,
    width: generateComputed('width'),
    level: generateComputed('level'),
    range,
  };
}
