import { defineStore } from 'pinia';
import { markRaw } from 'vue';

import type { Manifest, StateFile } from '@/src/io/state-file/schema';
import { createSegmentRegistry } from '@/src/segmentation/segmentRegistry';
import {
  removeSegmentReferences,
  segmentIsReferenced,
} from '@/src/segmentation/segmentReferences';

/**
 * Paint, rectangles, polygons and rulers share this registry and selection.
 * The same segment can hold masks and shapes on every image.
 */
export const useSegmentStore = defineStore('segments', () => {
  const registry = createSegmentRegistry({
    hasReferences: segmentIsReferenced,
    removeReferences: removeSegmentReferences,
  });

  function serialize(state: StateFile) {
    state.manifest.segments = registry.serialize();
    const selected = registry.selectedSegmentId.value;
    if (selected) state.manifest.selectedSegment = selected;
  }

  /** Fresh ids for the incoming segments; the map remaps every reference. */
  function deserialize(manifest: Manifest) {
    const segmentIdMap = registry.adopt(manifest.segments);
    const selected =
      manifest.selectedSegment && segmentIdMap[manifest.selectedSegment];
    // An import into a populated scene leaves the user's selection alone.
    if (selected && !registry.selectedSegment.value)
      registry.selectSegment(selected);
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
