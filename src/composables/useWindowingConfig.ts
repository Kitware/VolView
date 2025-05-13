import useWindowingStore from '@/src/store/view-configs/windowing';
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
