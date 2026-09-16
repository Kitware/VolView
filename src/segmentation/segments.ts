import { defineStore } from 'pinia';
import { markRaw } from 'vue';

import type { Manifest, StateFile } from '@/src/io/state-file/schema';
import { createSegmentRegistry } from '@/src/segmentation/segmentRegistry';

/**
 * Paint, rectangles, polygons and rulers share this registry and selection.
 * The same segment can hold masks and shapes on every image.
 */
export const useSegmentStore = defineStore('segments', () => {
  const registry = createSegmentRegistry();

  function serialize(state: StateFile) {
    state.manifest.segments = registry.serialize();
    const selected = registry.selectedSegmentId.value;
    if (selected) state.manifest.selectedSegment = selected;
  }

  /** Fresh ids for the incoming segments; the map remaps every reference. */
  function deserialize(manifest: Manifest) {
    const segmentIdMap = registry.adopt(manifest.segments);
    registry.restoreSelection(
      manifest.selectedSegment && segmentIdMap[manifest.selectedSegment]
    );
    return segmentIdMap;
  }

  // Raw: a pinia store is reactive, and a proxy of the registry would unwrap
  // its refs out from under every consumer that holds them.
  return {
    segments: markRaw(registry),
    serialize,
    deserialize,
  };
});
