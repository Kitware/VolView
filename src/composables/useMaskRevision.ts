import { ref, watchEffect } from 'vue';

import { useSegmentationStore } from '@/src/store/segmentations';
import { listMasks } from '@/src/types/segmentation';

/**
 * A counter every mask change bumps, voxel writes included. A mask's extent is
 * reactive but a write inside the box it already has moves nothing, so this is
 * the only trace of one a consumer can watch. It says something changed and
 * nothing about what, and a stroke bumps it once per sample, so debounce
 * anything expensive that reads it.
 *
 * Scoped to the caller: the masks are watched only while it is alive.
 */
export function useMaskRevision() {
  const segmentationStore = useSegmentationStore();
  const revision = ref(0);

  // Re-taken whenever a mask is seated or dropped. Every writer already
  // announces itself to vtk, so watching the mask itself catches the ones that
  // reach the buffer without going through the store.
  watchEffect((onCleanup) => {
    const subscriptions = Object.values(segmentationStore.segmentations)
      .flatMap((segmentation) => listMasks(segmentation))
      .flatMap((segment) => segment.representations.labelmap ?? [])
      .map((binding) =>
        binding.image.onModified(() => {
          revision.value += 1;
        })
      );
    onCleanup(() => subscriptions.forEach((entry) => entry.unsubscribe()));
  });

  return revision;
}
