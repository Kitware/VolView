import { defineStore } from 'pinia';
import { computed, markRaw, ref, watch } from 'vue';

import { onImageDeleted } from '@/src/composables/onImageDeleted';
import { declareManifestRefs } from '@/src/core/manifestRefs';
import { TOOL_COLORS } from '@/src/config';
import type { Manifest, StateFile } from '@/src/io/state-file/schema';
import type { ConfiguredSegments } from '@/src/io/import/configSegments';
import { cssColorToRGBA, tryCssColorToRGBA } from '@/src/segmentation/color';
import type { Segment } from '@/src/segmentation/segment';
import {
  createSegmentRegistry,
  type SegmentSetSnapshot,
} from '@/src/segmentation/segmentRegistry';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useViewStore } from '@/src/store/views';
import type { Maybe } from '@/src/types';
import { cleanUndefined, isRecord } from '@/src/utils';

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
  const registry = createSegmentRegistry((imageId) => {
    const source = pendingSets.get(imageId);
    if (source) {
      registry.initializeSet(imageId, source);
      pendingSets.delete(imageId);
    }
  });
  const imageCacheStore = useImageCacheStore();
  const viewStore = useViewStore();
  const seedSegmentDefaults = ref<Omit<Segment, 'id'>[]>([]);
  const activeImageId = computed(
    () => viewStore.getView(viewStore.activeView)?.dataID
  );
  const initializationReservations = new Map<string, number>();
  const pendingSets = new Map<string, SegmentSetSnapshot>();
  let lastImageId: string | undefined;

  const initializationDeferred = (imageId: string) =>
    initializationReservations.has(imageId);

  const defaultSnapshot = (): SegmentSetSnapshot => ({
    segments: seedSegmentDefaults.value.map((segment) => ({
      ...segment,
      color: [...segment.color],
    })),
    configured: seedSegmentDefaults.value.map(
      ({ name, color, fillOpacity, outlineOpacity, strokeWidth }, index) => ({
        name,
        index,
        appearance: {
          color: cssColorToRGBA(TOOL_COLORS[index % TOOL_COLORS.length]),
          fillOpacity: undefined,
          outlineOpacity: undefined,
          strokeWidth: undefined,
        },
        contribution: cleanUndefined({
          name,
          color: [...color],
          fillOpacity,
          outlineOpacity,
          strokeWidth,
        }),
        minted: true,
      })
    ),
  });

  watch(
    activeImageId,
    (imageId) => {
      if (!imageId || !imageCacheStore.imageById[imageId]) return;
      const previousImageId = lastImageId;
      lastImageId = imageId;
      if (registry.imageSets.value[imageId]) return;
      const source =
        previousImageId && registry.imageSets.value[previousImageId]
          ? registry.snapshot(previousImageId)
          : (previousImageId && pendingSets.get(previousImageId)) ||
            defaultSnapshot();
      if (initializationDeferred(imageId)) {
        if (!pendingSets.has(imageId)) pendingSets.set(imageId, source);
      } else registry.initializeSet(imageId, source);
    },
    { immediate: true, flush: 'sync' }
  );

  /** Imports install their definitions before a plain image borrows a set. */
  function deferInitialization(imageIds: readonly string[] = []) {
    const reservation = new Set(imageIds);
    reservation.forEach((imageId) => {
      initializationReservations.set(
        imageId,
        (initializationReservations.get(imageId) ?? 0) + 1
      );
    });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      reservation.forEach((imageId) => {
        const remaining = initializationReservations.get(imageId)! - 1;
        if (remaining > 0) initializationReservations.set(imageId, remaining);
        else initializationReservations.delete(imageId);
      });
      reservation.forEach((imageId) => {
        if (initializationDeferred(imageId)) return;
        const source = pendingSets.get(imageId);
        if (source && imageCacheStore.imageById[imageId])
          registry.initializeSet(imageId, source);
        pendingSets.delete(imageId);
      });
    };
  }

  async function withDeferredImageInitialization<T>(
    operation: (reserveImage: (imageId: string) => void) => T | Promise<T>
  ): Promise<T> {
    const releases = new Map<string, () => void>();
    let active = true;
    const reserveImage = (imageId: string) => {
      if (active && !releases.has(imageId))
        releases.set(imageId, deferInitialization([imageId]));
    };
    try {
      return await operation(reserveImage);
    } finally {
      active = false;
      releases.forEach((release) => release());
      releases.clear();
    }
  }

  function replaceConfigSegments(
    configured: Maybe<ConfiguredSegments>,
    imageIds?: string[]
  ) {
    if (configured === undefined) return;
    seedSegmentDefaults.value = Object.entries(configured ?? {}).map(
      ([name, { color, ...appearance }], index) => ({
        name,
        color:
          (color && tryCssColorToRGBA(color)) ||
          cssColorToRGBA(TOOL_COLORS[index % TOOL_COLORS.length]),
        visible: true,
        locked: false,
        ...cleanUndefined(appearance),
      })
    );
    const targets =
      imageIds ?? (activeImageId.value ? [activeImageId.value] : []);
    targets
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
    state.manifest.seedSegmentDefaults = seedSegmentDefaults.value.map(
      (segment) => ({
        ...segment,
        color: [...segment.color],
      })
    );
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
      const incoming = [...new Set(set.segmentIds)].flatMap(
        (id) => catalogById.get(id) ?? []
      );
      const unclaimed = incoming.filter(
        ({ id }) => !Object.hasOwn(segmentIdMap, id)
      );
      repeated.push(
        ...incoming.filter(({ id }) => Object.hasOwn(segmentIdMap, id))
      );
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
      seedSegmentDefaults.value = manifest.seedSegmentDefaults.map(
        (segment) => ({
          ...segment,
          color: [...segment.color],
        })
      );
      const savedImages = new Set(
        (manifest.imageSegmentSets ?? []).map(
          ({ imageId }) => dataIDMap[imageId]
        )
      );
      Object.values(dataIDMap).forEach((imageId) => {
        if (!savedImages.has(imageId) && pendingSets.has(imageId))
          pendingSets.set(imageId, defaultSnapshot());
      });
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
      pendingSets.delete(imageId);
      registry.removeImage(imageId);
    });
  });

  return {
    segments: markRaw(registry),
    seedSegmentDefaults,
    deferInitialization,
    withDeferredImageInitialization,
    replaceConfigSegments,
    serialize,
    deserialize,
  };
});
