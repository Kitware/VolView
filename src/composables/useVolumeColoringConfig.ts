import { computed, type MaybeRef, unref } from 'vue';
import { useImage } from '@/src/composables/useCurrentImage';
import { useVtkComputed } from '@/src/core/vtk/useVtkComputed';
import useVolumeColoringStore from '@/src/store/view-configs/volume-coloring';
import type { Maybe } from '@/src/types';

export function useVolumeColoringConfig(
  viewId: MaybeRef<Maybe<string>>,
  imageId: MaybeRef<Maybe<string>>
) {
  const store = useVolumeColoringStore();
  const { imageData } = useImage(imageId);
  const provisionalColoring = useVtkComputed(imageData, () =>
    store.getProvisionalColoring(unref(imageId))
  );

  return computed(
    () =>
      store.getConfig(unref(viewId), unref(imageId)) ??
      provisionalColoring.value
  );
}
