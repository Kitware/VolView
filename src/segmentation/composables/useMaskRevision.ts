import { ref, watchEffect } from 'vue';

import { useSegmentStore } from '@/src/segmentation/segments';
import { writeRegion } from '@/src/segmentation/masks/writeRegion';
import type { Extent3D } from '@/src/segmentation/geometry';
import type { Maybe } from '@/src/types';

/**
 * A counter every change to one image's masks bumps, voxel writes included. A
 * mask's extent is reactive but a write inside the box it already has moves
 * nothing, so this is the only trace of one a consumer can watch. It says
 * something changed and nothing about what. A stroke bumps it once per changed
 * mask per sample, so debounce anything expensive that reads it.
 *
 * A write confined to a box `concerns` rejects does not bump it.
 *
 * Scoped to the caller: the masks are watched only while it is alive.
 */
export function useMaskRevision(
  imageId: () => Maybe<string>,
  concerns: (region: Extent3D) => boolean = () => true
) {
  const registry = useSegmentStore().segments;
  const revision = ref(0);

  // Re-taken whenever a mask is seated or dropped. Every writer already
  // announces itself to vtk, so watching the mask itself catches the ones that
  // reach the buffer without going through the store.
  watchEffect((onCleanup) => {
    const subscriptions = registry.imageMasks(imageId()).map(({ binding }) =>
      binding.image.onModified(() => {
        const region = writeRegion();
        if (region && !concerns(region)) return;
        revision.value += 1;
      })
    );
    onCleanup(() => subscriptions.forEach((entry) => entry?.unsubscribe()));
  });

  return revision;
}
