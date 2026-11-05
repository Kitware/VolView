import { defineStore } from 'pinia';
import { markRaw, ref, watch } from 'vue';

import { onImageDeleted } from '@/src/composables/onImageDeleted';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { declareManifestRefs } from '@/src/core/manifestRefs';
import {
  manifestDatasets,
  type Manifest,
  type StateFile,
} from '@/src/io/state-file/schema';
import type { ConfiguredSegments } from '@/src/io/import/configSegments';
import type { ManifestMigration } from '@/src/io/state-file/migrations';
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

const hasOnlyArtifactSegments = (manifest: Manifest) =>
  manifest.segmentationArtifacts?.length &&
  !manifest.segments?.length &&
  !manifest.imageSegmentSets?.length;

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
  const lastImageId = ref<string>();

  const defaultSnapshot = () => snapshotFromDefaults(seedSegmentDefaults.value);

  const sourceImageId = (imageId?: Maybe<string>) =>
    [imageId, lastImageId.value].find(
      (id): id is string => !!id && !!registry.imageSets.value[id]
    );

  // A new set copies the last viewed image's, else starts from the defaults.
  const inheritedSet = () => {
    const source = sourceImageId();
    return source ? registry.snapshot(source) : defaultSnapshot();
  };

  const previewSegmentColor = (imageId: Maybe<string>) => {
    const source = sourceImageId(imageId);
    if (source) {
      const segmentId = registry.selectedSegmentId(source);
      return segmentId
        ? registry.appearanceOf(segmentId).color
        : registry.nextSegmentColor(source);
    }
    return (
      seedSegmentDefaults.value[0]?.color ??
      registry.nextSegmentColor(undefined)
    );
  };

  watch(
    activeImageId,
    (imageId) => {
      if (!imageId || !imageCacheStore.imageById[imageId]) return;
      prepareForEdit(imageId);
      lastImageId.value = imageId;
    },
    { immediate: true, flush: 'sync' }
  );

  /** Incoming definitions merge into the defaults, not a copy nobody edited. */
  function seedDefaults(
    imageId: string,
    defaults: readonly SegmentDefaults[] = seedSegmentDefaults.value
  ) {
    registry.releaseBorrowed(imageId);
    if (
      imageCacheStore.imageById[imageId] &&
      !registry.imageSets.value[imageId]
    )
      registry.initializeSet(imageId, snapshotFromDefaults(defaults));
  }

  function replaceConfigSegments(
    configured: Maybe<ConfiguredSegments>,
    imageIds: string[],
    { replaceBorrowed = false } = {}
  ) {
    if (configured === undefined) return;
    seedSegmentDefaults.value = defaultsFromConfig(configured ?? {});
    [...new Set(imageIds)]
      .filter((id) => imageCacheStore.imageById[id])
      .forEach((imageId) => {
        if (replaceBorrowed) registry.releaseBorrowed(imageId);
        registry.replaceConfigSegments(imageId, configured);
      });
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

  function restoreDefaults(
    manifest: Manifest,
    dataIDMap: Record<string, string>
  ) {
    // Artifact-only manifests provide incoming definitions through their masks.
    // Initialize every restored image before views or asynchronous decoding can
    // give the active image a different borrowed set.
    if (manifest.seedSegmentDefaults || hasOnlyArtifactSegments(manifest)) {
      if (manifest.seedSegmentDefaults)
        seedSegmentDefaults.value =
          manifest.seedSegmentDefaults.map(withCopiedColor);
      const savedImages = new Set(
        (manifest.imageSegmentSets ?? []).map(
          ({ imageId }) => dataIDMap[imageId]
        )
      );
      const incomingImageIds = [
        ...manifestDatasets(manifest).map(({ id }) => id),
        ...(manifest.segmentationArtifacts ?? []).map(
          ({ parentImage }) => parentImage
        ),
      ].map((id) => dataIDMap[id]);
      [...new Set(incomingImageIds)]
        .filter((imageId) => imageId && !savedImages.has(imageId))
        .forEach((imageId) => seedDefaults(imageId));
    }
  }

  function deserialize(
    manifest: Manifest,
    dataIDMap: Record<string, string>,
    migration?: ManifestMigration
  ) {
    const segmentIdMap: Record<string, string> = Object.create(null);
    const repeated: Array<{
      name: string;
      imageId: string;
      sourceRow: number;
    }> = [];
    const claimedTargets = new Set<string>();
    const legacyByImage = new Map<string, Map<string, string>>();
    const catalogById = new Map<string, Segment[]>();
    const sourceRows = new Map<Segment, number>();
    for (const [index, segment] of (manifest.segments ?? []).entries()) {
      sourceRows.set(segment, migration?.segmentSourceRows[index] ?? index);
      const entries = catalogById.get(segment.id);
      if (entries) entries.push(segment);
      else catalogById.set(segment.id, [segment]);
    }
    const reportRepeated = (entries: Segment[], imageId: string) => {
      entries.forEach((segment) =>
        repeated.push({
          name: segment.name,
          imageId,
          sourceRow: sourceRows.get(segment)!,
        })
      );
    };
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
      reportRepeated(claimed, set.imageId);
      const legacy = legacyByImage.get(imageId) ?? new Map<string, string>();
      legacyByImage.set(imageId, legacy);
      const distinct = unclaimed.filter(({ id }) => {
        const original = migration?.legacySegmentIds[id];
        const target =
          original === undefined ? undefined : legacy.get(original);
        if (!target) return true;
        segmentIdMap[id] = target;
        return false;
      });
      const adopted = registry.adopt(imageId, distinct, claimedTargets);
      Object.assign(segmentIdMap, adopted.idMap);
      reportRepeated(adopted.repeated, set.imageId);
      set.segmentIds.forEach((id) => {
        const original = migration?.legacySegmentIds[id];
        if (original !== undefined && segmentIdMap[id])
          legacy.set(original, segmentIdMap[id]);
      });
      registry.restoreSelection(
        imageId,
        set.selectedSegmentId && segmentIdMap[set.selectedSegmentId]
      );
    });
    restoreDefaults(manifest, dataIDMap);
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
      if (lastImageId.value === imageId) lastImageId.value = undefined;
      registry.removeImage(imageId);
    });
  });

  return {
    segments: markRaw(registry),
    seedSegmentDefaults,
    prepareForEdit,
    previewSegmentColor,
    seedDefaults,
    replaceConfigSegments,
    serialize,
    deserialize,
  };
});
