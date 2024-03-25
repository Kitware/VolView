import useViewSliceStore, {
  defaultSliceConfig,
} from '@/src/store/view-configs/slicing';
import { Maybe } from '@/src/types';
import type { Vector2 } from '@kitware/vtk.js/types';
import { unref, MaybeRef, computed } from 'vue';

export function useSliceConfig(
  viewID: MaybeRef<string>,
  imageID: MaybeRef<Maybe<string>>
) {
  const store = useViewSliceStore();
  const configDefaults = defaultSliceConfig();
  const config = computed(() => store.getConfig(unref(viewID), unref(imageID)));

  const slice = computed({
    get: () => config.value?.slice ?? configDefaults.slice,
    set: (val) => {
      const imageIdVal = unref(imageID);
      if (!imageIdVal || val == null) return;
      store.updateConfig(unref(viewID), imageIdVal, { slice: val });
    },
  });
  const range = computed((): Vector2 => {
    const { min, max } = config.value ?? {};
    if (min == null || max == null)
      return [configDefaults.min, configDefaults.max];
    return [min, max];
  });

  return { config, slice, range };
}
