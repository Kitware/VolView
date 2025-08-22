import useViewSliceStore from '@/src/store/view-configs/slicing';
import { Maybe } from '@/src/types';
import type { Vector2 } from '@kitware/vtk.js/types';
import { unref, MaybeRef, computed } from 'vue';

export function useSliceConfig(
  viewID: MaybeRef<Maybe<string>>,
  imageID: MaybeRef<Maybe<string>>
) {
  const store = useViewSliceStore();
  const config = computed(() => store.getConfig(unref(viewID), unref(imageID)));

  const slice = computed({
    get: () => config.value.slice,
    set: (val) => {
      const imageIdVal = unref(imageID);
      const viewIdVal = unref(viewID);
      if (!viewIdVal || !imageIdVal || val == null) return;
      store.updateConfig(viewIdVal, imageIdVal, { slice: val });

      // Update other synchronized views if any
      if (config.value?.syncState) {
        store.updateSyncConfigs();
      }
    },
  });
  const range = computed((): Vector2 => {
    const { min, max } = config.value;
    return [min, max];
  });

  return { config, slice, range };
}
