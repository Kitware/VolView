import { defineStore } from 'pinia';
import { markRaw, watch } from 'vue';

import { onImageDeleted } from '@/src/composables/onImageDeleted';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { declareManifestRefs } from '@/src/core/manifestRefs';
import type { Manifest, StateFile } from '@/src/io/state-file/schema';
import { DEFAULT_SEGMENT_COLOR } from '@/src/segmentation/segment';
import {
  createSegmentRegistry,
  type RestoredSegment,
} from '@/src/segmentation/segmentRegistry';
import { isEmptyExtent } from '@/src/segmentation/geometry';
import { fromConfigured } from '@/src/segmentation/segmentConfig';
import { useSegmentationEditsStore } from '@/src/segmentation/editing/coordinator';
import { useImageCacheStore } from '@/src/store/image-cache';
import type { Maybe } from '@/src/types';
import { isRecord } from '@/src/utils';

declareManifestRefs('imageSegments', (manifest) =>
  (Array.isArray(manifest.imageSegments) ? manifest.imageSegments : []).flatMap(
    (entry, index) => {
      if (!isRecord(entry)) return [];
      const where = `imageSegments[${index}]`;
      return [
        ...(typeof entry.imageId === 'string'
          ? [{ kind: 'dataset' as const, id: entry.imageId, where }]
          : []),
        ...(typeof entry.selectedSegmentId === 'string'
          ? [
              {
                kind: 'segment' as const,
                id: entry.selectedSegmentId,
                where: `${where}.selectedSegmentId`,
              },
            ]
          : []),
      ];
    }
  )
);

/** A saved segment id's restored segment, on the image the id was saved with. */
export type SegmentResolver = (
  imageId: string,
  savedId: Maybe<string>
) => string | undefined;

/** Paint and annotation shapes share definitions within their owning image. */
export const useSegmentStore = defineStore('segments', () => {
  const imageCacheStore = useImageCacheStore();
  const imageExists = (imageId: string) => !!imageCacheStore.imageById[imageId];
  const registry = createSegmentRegistry({
    imageExists,
    beforeMaskRemoval: () => useSegmentationEditsStore().beforeEdit(),
  });
  const { currentImageID: activeImageId } = useCurrentImage('global');

  const previewSegmentColor = (imageId: Maybe<string>) => {
    if (imageId && registry.imageSets.value[imageId]) {
      const segmentId = registry.selectedSegmentId(imageId);
      return segmentId
        ? registry.appearanceOf(segmentId).color
        : registry.nextSegmentColor(imageId);
    }
    const [first] = Object.entries(registry.configTemplate.value);
    return (first && fromConfigured(...first).color) ?? DEFAULT_SEGMENT_COLOR;
  };

  // A shown image lists the config's segments before anything edits it.
  watch(
    activeImageId,
    (imageId) => {
      if (imageId && imageExists(imageId)) registry.ensureSet(imageId);
    },
    { immediate: true, flush: 'sync' }
  );

  /** Each image's segments in order, without their masks. */
  function serialize(state: StateFile) {
    state.manifest.imageSegments = Object.entries(registry.imageSets.value).map(
      ([imageId, set]) => ({
        imageId,
        selectedSegmentId: registry.selectedSegmentId(imageId),
        ...(set.display ? { display: { ...set.display } } : {}),
        segments: set.order.map((id) => ({ ...set.segments[id] })),
      })
    );
  }

  function deserialize(manifest: Manifest, dataIDMap: Record<string, string>) {
    const restored = (manifest.imageSegments ?? []).flatMap((entry) => {
      const imageId = dataIDMap[entry.imageId];
      return imageId && imageCacheStore.imageById[imageId]
        ? [{ imageId, entry }]
        : [];
    });
    // Several saved images can resolve to one: their segments seat together.
    const incoming = new Map<string, RestoredSegment[]>();
    restored.forEach(({ imageId, entry }) =>
      incoming.set(imageId, [
        ...(incoming.get(imageId) ?? []),
        ...entry.segments.map(({ labelmap, ...segment }) => ({
          ...segment,
          withMask:
            !!labelmap &&
            (labelmap.artifactId !== undefined ||
              !isEmptyExtent(labelmap.extent)),
        })),
      ])
    );
    const idsByImage = new Map(
      [...incoming].map(([imageId, segments]) => [
        imageId,
        registry.adopt(imageId, segments),
      ])
    );
    const resolve: SegmentResolver = (imageId, savedId) =>
      savedId ? idsByImage.get(imageId)?.get(savedId) : undefined;
    restored.forEach(({ imageId, entry }) => {
      registry.restoreSelection(
        imageId,
        resolve(imageId, entry.selectedSegmentId)
      );
      if (entry.display) registry.restoreDisplay(imageId, entry.display);
    });
    return resolve;
  }

  function applyTemplateToRestored(
    manifest: Manifest,
    dataIDMap: Record<string, string>
  ) {
    (manifest.imageSegments ?? []).forEach(({ imageId }) =>
      registry.applyTemplate(dataIDMap[imageId])
    );
  }

  onImageDeleted((deleted) => {
    deleted.forEach((imageId) => registry.removeImage(imageId));
  });

  // Pinia must not unwrap the registry refs held by its consumers.
  return {
    segments: markRaw(registry),
    previewSegmentColor,
    serialize,
    deserialize,
    applyTemplateToRestored,
  };
});
