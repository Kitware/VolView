import { defineStore } from 'pinia';
import { markRaw, ref, watch } from 'vue';

import { onImageDeleted } from '@/src/composables/onImageDeleted';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { declareManifestRefs } from '@/src/core/manifestRefs';
import type { Manifest, StateFile } from '@/src/io/state-file/schema';
import type { ConfiguredSegments } from '@/src/io/import/configSegments';
import type { Segment } from '@/src/segmentation/segment';
import {
  createSegmentRegistry,
  defaultsFromConfig,
  snapshotFromDefaults,
  withCopiedColor,
  type SegmentDefaults,
} from '@/src/segmentation/segmentRegistry';
import { useImageCacheStore } from '@/src/store/image-cache';
import type { Maybe } from '@/src/types';
import { isRecord, partition } from '@/src/utils';

declareManifestRefs('imageSegmentSets', (manifest) =>
  (Array.isArray(manifest.imageSegmentSets)
    ? manifest.imageSegmentSets
    : []
  ).flatMap((set, index) => {
    if (!isRecord(set)) return [];
    const where = `imageSegmentSets[${index}]`;
    return [
      ...(typeof set.imageId === 'string'
        ? [{ kind: 'dataset' as const, id: set.imageId, where }]
        : []),
      ...(Array.isArray(set.segmentIds) ? set.segmentIds : []).flatMap((id) =>
        typeof id === 'string'
          ? [{ kind: 'segment' as const, id, where: `${where}.segmentIds` }]
          : []
      ),
      ...(typeof set.selectedSegmentId === 'string'
        ? [
            {
              kind: 'segment' as const,
              id: set.selectedSegmentId,
              where: `${where}.selectedSegmentId`,
            },
          ]
        : []),
    ];
  })
);

/** Paint and annotation shapes share definitions within their owning image. */
export const useSegmentStore = defineStore('segments', () => {
  const imageCacheStore = useImageCacheStore();
  // An image edited before it was ever viewed seeds as if it had been viewed.
  const prepareForEdit = (imageId: string) => {
    if (
      !registry.imageSets.value[imageId] &&
      imageCacheStore.imageById[imageId]
    )
      registry.initializeSet(imageId, inheritedSet(), { copied: true });
  };
  const registry = createSegmentRegistry(prepareForEdit);
  const seedSegmentDefaults = ref<SegmentDefaults[]>([]);
  const { currentImageID: activeImageId } = useCurrentImage('global');
  let lastImageId: string | undefined;

  const defaultSnapshot = () => snapshotFromDefaults(seedSegmentDefaults.value);

  // A new set copies the last viewed image's, else starts from the defaults.
  const inheritedSet = () =>
    lastImageId && registry.imageSets.value[lastImageId]
      ? registry.snapshot(lastImageId)
      : defaultSnapshot();

  watch(
    activeImageId,
    (imageId) => {
      if (!imageId || !imageCacheStore.imageById[imageId]) return;
      prepareForEdit(imageId);
      lastImageId = imageId;
    },
    { immediate: true, flush: 'sync' }
  );

  /** Incoming definitions merge into the defaults, not a copy nobody edited. */
  function seedDefaults(imageId: string) {
    registry.releaseBorrowed(imageId);
    if (imageCacheStore.imageById[imageId])
      registry.initializeSet(imageId, defaultSnapshot());
  }

  function replaceConfigSegments(
    configured: Maybe<ConfiguredSegments>,
    imageIds: string[]
  ) {
    if (configured === undefined) return;
    seedSegmentDefaults.value = defaultsFromConfig(configured ?? {});
    imageIds
      .filter((id) => imageCacheStore.imageById[id])
      .forEach((imageId) =>
        registry.replaceConfigSegments(imageId, configured)
      );
  }

  function serialize(state: StateFile) {
    state.manifest.segments = registry.serialize();
    state.manifest.imageSegmentSets = Object.entries(
      registry.imageSets.value
    ).map(([imageId, set]) => ({
      imageId,
      segmentIds: [...set.segmentIds],
      selectedSegmentId: registry.selectedSegmentId(imageId),
    }));
    state.manifest.seedSegmentDefaults =
      seedSegmentDefaults.value.map(withCopiedColor);
  }

  function deserialize(manifest: Manifest, dataIDMap: Record<string, string>) {
    const segmentIdMap: Record<string, string> = Object.create(null);
    const repeated: Segment[] = [];
    const claimedTargets = new Set<string>();
    const legacyByImage = new Map<string, Map<string, string>>();
    const catalogById = new Map<string, Segment[]>();
    for (const segment of manifest.segments ?? []) {
      const entries = catalogById.get(segment.id);
      if (entries) entries.push(segment);
      else catalogById.set(segment.id, [segment]);
    }
    (manifest.imageSegmentSets ?? []).forEach((set) => {
      const imageId = dataIDMap[set.imageId];
      if (!imageId || !imageCacheStore.imageById[imageId]) return;
      registry.releaseBorrowed(imageId);
      const incoming = [...new Set(set.segmentIds)].flatMap(
        (id) => catalogById.get(id) ?? []
      );
      const [claimed, unclaimed] = partition(
        ({ id }) => Object.hasOwn(segmentIdMap, id),
        incoming
      );
      repeated.push(...claimed);
      const legacy = legacyByImage.get(imageId) ?? new Map<string, string>();
      legacyByImage.set(imageId, legacy);
      const distinct = unclaimed.filter(({ id }) => {
        const original = set.legacySegmentIds?.[id];
        const target =
          original === undefined ? undefined : legacy.get(original);
        if (!target) return true;
        segmentIdMap[id] = target;
        return false;
      });
      const adopted = registry.adopt(imageId, distinct, claimedTargets);
      Object.assign(segmentIdMap, adopted.idMap);
      repeated.push(...adopted.repeated);
      Object.entries(set.legacySegmentIds ?? {}).forEach(([id, original]) => {
        if (segmentIdMap[id]) legacy.set(original, segmentIdMap[id]);
      });
      registry.restoreSelection(
        imageId,
        set.selectedSegmentId && segmentIdMap[set.selectedSegmentId]
      );
    });
    if (manifest.seedSegmentDefaults) {
      seedSegmentDefaults.value =
        manifest.seedSegmentDefaults.map(withCopiedColor);
      const savedImages = new Set(
        (manifest.imageSegmentSets ?? []).map(
          ({ imageId }) => dataIDMap[imageId]
        )
      );
      Object.values(dataIDMap)
        .filter((imageId) => !savedImages.has(imageId))
        .forEach(seedDefaults);
    }
    const assigned = new Set(
      (manifest.imageSegmentSets ?? []).flatMap(({ segmentIds }) => segmentIds)
    );
    const unassigned = (manifest.segments ?? []).filter(
      ({ id }) => !assigned.has(id)
    );
    return { segmentIdMap, repeated, unassigned };
  }

  onImageDeleted((deleted) => {
    deleted.forEach((imageId) => {
      if (lastImageId === imageId) lastImageId = undefined;
      registry.removeImage(imageId);
    });
  });

  return {
    segments: markRaw(registry),
    seedSegmentDefaults,
    prepareForEdit,
    seedDefaults,
    replaceConfigSegments,
    serialize,
    deserialize,
  };
});
