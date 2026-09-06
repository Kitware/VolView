import { defineStore } from 'pinia';
import { markRaw } from 'vue';

import type { Manifest, StateFile } from '@/src/io/state-file/schema';
import { createSegmentTypeRegistry } from '@/src/store/tools/segmentTypeRegistry';
import {
  removeSegmentTypeReferences,
  segmentTypeIsReferenced,
} from '@/src/store/tools/segmentTypeReferences';

/**
 * The one registry paint, rectangles and polygons share: selecting a type in
 * any of them selects it in all three, and the same type can be painted on
 * every image. Rulers hold their own instance of the same implementation.
 */
export const useSegmentTypeStore = defineStore('segmentTypes', () => {
  const registry = createSegmentTypeRegistry({
    hasReferences: segmentTypeIsReferenced,
    removeReferences: removeSegmentTypeReferences,
  });

  function serialize(state: StateFile) {
    state.manifest.segmentTypes = registry.serialize();
    const selected = registry.selectedTypeId.value;
    if (selected) state.manifest.selectedSegmentType = selected;
  }

  /** Fresh ids for the incoming types; the map remaps every reference. */
  function deserialize(manifest: Manifest) {
    const typeIdMap = registry.adopt(manifest.segmentTypes);
    const selected =
      manifest.selectedSegmentType && typeIdMap[manifest.selectedSegmentType];
    // An import into a populated scene leaves the user's selection alone.
    if (selected && !registry.selectedType.value) registry.selectType(selected);
    return typeIdMap;
  }

  // Raw: a pinia store is reactive, and a proxy of the registry would unwrap
  // its refs out from under every consumer that holds them.
  return {
    types: markRaw(registry),
    serialize,
    deserialize,
  };
});
