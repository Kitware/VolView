import { defineStore } from 'pinia';
import { markRaw } from 'vue';

import { onImageDeleted } from '@/src/composables/onImageDeleted';
import type { Manifest, StateFile } from '@/src/io/state-file/schema';
import { createSegmentRegistry } from '@/src/segmentation/segmentRegistry';
import { useImageCacheStore } from '@/src/store/image-cache';

/**
 * Paint, rectangles, polygons and rulers share this registry and selection.
 * The same segment can hold masks and shapes on every image.
 */
export const useSegmentStore = defineStore('segments', () => {
  const registry = createSegmentRegistry();
  const imageCacheStore = useImageCacheStore();

  function serialize(state: StateFile) {
    state.manifest.segments = registry.serialize();
    const selected = registry.selectedSegmentId.value;
    if (selected) state.manifest.selectedSegment = selected;
  }

  /** Fresh ids for the incoming segments; segmentIdMap remaps every reference. */
  function deserialize(manifest: Manifest) {
    const { idMap: segmentIdMap, repeated } = registry.adopt(manifest.segments);
    registry.restoreSelection(
      manifest.selectedSegment && segmentIdMap[manifest.selectedSegment]
    );
    return { segmentIdMap, repeated };
  }

  // Swept as the last image leaves, never later, so a following load keeps its segments.
  onImageDeleted(() => {
    if (imageCacheStore.imageIds.length > 0) return;
    registry.segmentList.value
      .filter(({ id }) => !registry.heldByConfig(id))
      .forEach(({ id }) => registry.deleteSegment(id));
  });

  // Raw: a pinia store is reactive, and a proxy of the registry would unwrap
  // its refs out from under every consumer that holds them.
  return {
    segments: markRaw(registry),
    serialize,
    deserialize,
  };
});
