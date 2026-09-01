import { defineStore } from 'pinia';
import { computed, markRaw, reactive, shallowRef, toRaw, watch } from 'vue';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { RGBAColor } from '@kitware/vtk.js/types';

import { CATEGORICAL_COLORS, DEFAULT_SEGMENT_MASKS } from '@/src/config';
import { NO_NAME } from '@/src/constants';
import { onImageDeleted } from '@/src/composables/onImageDeleted';
import { declareManifestRefs } from '@/src/core/manifestRefs';
import { untilLoaded } from '@/src/composables/untilLoaded';
import { readImage, writeSegmentation } from '@/src/io/readWriteImage';
import type { ArtifactRestoreSource } from '@/src/io/import/processors/restoreStateFile';
import type {
  Manifest,
  SegmentationArtifact,
  StateFile,
} from '@/src/io/state-file/schema';
import { makeSegmentGroupArchivePath } from '@/src/io/state-file/segmentGroupArchivePath';
import type { FileEntry } from '@/src/io/types';
import { useDatasetStore } from '@/src/store/datasets';
import { useIdStore } from '@/src/store/id';
import { useImageCacheStore } from '@/src/store/image-cache';
import {
  createLabelmapFromImage,
  LABELMAP_BACKGROUND_VALUE,
  makeDefaultSegmentGroupName,
  makeDefaultSegmentName,
  toLabelMap,
  useSegmentGroupStore,
} from '@/src/store/segmentGroups';
import type { Maybe, ProcessingResultSource } from '@/src/types';
import {
  isEmptyExtent,
  listSegments,
  type ActiveSegmentationTarget,
  type ActiveSegmentIntent,
  type Extent3D,
  type LabelmapSegment,
  type Segment,
  type Segmentation,
} from '@/src/types/segmentation';
import { isRecord, removeFromArray } from '@/src/utils';
import { normalize } from '@/src/utils/path';
import vtkLabelMap from '@/src/vtk/LabelMap';

export type ArtifactMetadata = {
  parentImage: string;
  name: string;
  source?: ProcessingResultSource;
};

export type SegmentInit = {
  name?: string;
  color?: RGBAColor;
};

export type SegmentPatch = Partial<Omit<Segment, 'id' | 'representations'>>;

/**
 * The labelmap codec the state file writes through. Injected because itk-wasm
 * and the vti worker have no node counterpart.
 */
export type SegmentationArtifactIO = {
  write: (
    format: string,
    labelmap: vtkLabelMap,
    segments: LabelmapSegment[]
  ) => Promise<string | Uint8Array>;
  read: (
    file: File
  ) => Promise<{ image: vtkImageData; headerMetadata?: Map<string, string> }>;
};

const defaultArtifactIO: SegmentationArtifactIO = {
  write: writeSegmentation,
  read: readImage,
};

const fullExtent = (dimensions: number[]): Extent3D => [
  0,
  dimensions[0] - 1,
  0,
  dimensions[1] - 1,
  0,
  dimensions[2] - 1,
];

const pickUniqueSegmentName = (taken: Iterable<string>) => {
  const existing = new Set(taken);
  let index = 1;
  while (existing.has(makeDefaultSegmentName(index))) index += 1;
  return makeDefaultSegmentName(index);
};

// The manifest references this store's remove cascade keeps clean (see the
// onImageDeleted registration below), declared for the dev-only save backstop.
declareManifestRefs('segmentations', (manifest) => {
  const segmentations = Array.isArray(manifest.segmentations)
    ? manifest.segmentations
    : [];
  const artifacts = Array.isArray(manifest.segmentationArtifacts)
    ? manifest.segmentationArtifacts
    : [];

  return [
    ...segmentations.flatMap((raw, index) => {
      if (!isRecord(raw)) return [];
      const where = `segmentations[${index}]`;
      const segments = Array.isArray(raw.segments) ? raw.segments : [];
      return [
        ...(typeof raw.parentImage === 'string'
          ? [
              {
                kind: 'dataset' as const,
                id: raw.parentImage,
                where: `${where}.parentImage`,
              },
            ]
          : []),
        ...segments.flatMap((segment, segmentIndex) => {
          const binding = isRecord(segment)
            ? (segment.representations as Record<string, unknown> | undefined)
                ?.labelmap
            : undefined;
          return isRecord(binding) && typeof binding.artifactId === 'string'
            ? [
                {
                  kind: 'segmentationArtifact' as const,
                  id: binding.artifactId,
                  where: `${where}.segments[${segmentIndex}].representations.labelmap.artifactId`,
                },
              ]
            : [];
        }),
      ];
    }),
    ...artifacts.flatMap((raw, index) =>
      isRecord(raw) && typeof raw.parentImage === 'string'
        ? [
            {
              kind: 'dataset' as const,
              id: raw.parentImage,
              where: `segmentationArtifacts[${index}].parentImage`,
            },
          ]
        : []
    ),
  ];
});

export const useSegmentationStore = defineStore('segmentation', () => {
  const imageCacheStore = useImageCacheStore();

  const segmentations = reactive<Record<string, Segmentation>>({});
  const byParentImage = reactive<Record<string, string>>({});
  // Internal storage layer: UI and tools reach it through this store's API only.
  const artifactIndex = reactive<Record<string, vtkLabelMap>>({});
  const artifactMeta = reactive<Record<string, ArtifactMetadata>>({});
  const artifactOrderByParent = reactive<Record<string, string[]>>({});

  // Names keep counting up per parent image so a deleted artifact's name is
  // not immediately handed to the next one. Cleared by the deletion cascade.
  const nextDefaultIndex: Record<string, number> = Object.create(null);

  function pickUniqueArtifactName(
    formatName: (index: number) => string,
    parentImageId: string
  ) {
    const existing = new Set(
      Object.values(artifactMeta).map((meta) => meta.name)
    );
    let name = '';
    do {
      const nameIndex = nextDefaultIndex[parentImageId] ?? 1;
      nextDefaultIndex[parentImageId] = nameIndex + 1;
      name = formatName(nameIndex);
    } while (existing.has(name));
    return name;
  }

  function getSegmentation(segmentationId: string) {
    const segmentation = segmentations[segmentationId];
    if (!segmentation) throw new Error('No such segmentation');
    return segmentation;
  }

  function getSegment(segmentationId: string, segmentId: string) {
    const segment = getSegmentation(segmentationId).segments[segmentId];
    if (!segment) throw new Error('No such segment');
    return segment;
  }

  const bindingsForArtifact = (artifactId: string) =>
    segmentsForArtifact(artifactId).map(
      (segment) => segment.representations.labelmap!
    );

  function getSegmentationForImage(parentImageId: string) {
    const id = byParentImage[parentImageId];
    return id ? segmentations[id] : undefined;
  }

  function ensureSegmentationForImage(parentImageId: string) {
    const existing = getSegmentationForImage(parentImageId);
    if (existing) return existing;

    const id = useIdStore().nextId();
    segmentations[id] = {
      id,
      name: imageCacheStore.getImageMetadata(parentImageId)?.name ?? NO_NAME,
      parentImageId,
      segments: {},
      order: [],
      fillOpacity: 1,
      outlineOpacity: 1,
      outlineThickness: 2,
    };
    byParentImage[parentImageId] = id;
    return segmentations[id];
  }

  // Deliberately separate from the decode path's cursor: decoded catalogs must
  // be reproducible regardless of how many segments this session has created.
  let nextColorIndex = 0;
  function getNextColor(): RGBAColor {
    const color = CATEGORICAL_COLORS[nextColorIndex];
    nextColorIndex = (nextColorIndex + 1) % CATEGORICAL_COLORS.length;
    return [...color, 255] as RGBAColor;
  }

  function createSegment(segmentationId: string, init?: SegmentInit) {
    const segmentation = getSegmentation(segmentationId);
    const id = useIdStore().nextId();
    segmentation.segments[id] = {
      id,
      name:
        init?.name ??
        pickUniqueSegmentName(
          listSegments(segmentation).map((segment) => segment.name)
        ),
      color: init?.color ? ([...init.color] as RGBAColor) : getNextColor(),
      visible: true,
      locked: false,
      fillOpacity: 1,
      outlineOpacity: 1,
      representations: {},
    };
    segmentation.order.push(id);
    return segmentation.segments[id];
  }

  const artifactsForImage = (parentImageId: string) =>
    artifactOrderByParent[parentImageId] ?? [];

  function getSegmentationForArtifact(artifactId: string) {
    const parentImage = artifactMeta[artifactId]?.parentImage;
    return parentImage ? getSegmentationForImage(parentImage) : undefined;
  }

  /** The ordered segments whose labelmap binding points at one artifact. */
  function segmentsForArtifact(artifactId: string) {
    const segmentation = getSegmentationForArtifact(artifactId);
    if (!segmentation) return [];
    return listSegments(segmentation).filter(
      (segment) => segment.representations.labelmap?.artifactId === artifactId
    );
  }

  /** The artifact an operation's labelmap belongs to. */

  function findSegmentByLabelValue(artifactId: string, labelValue: number) {
    return segmentsForArtifact(artifactId).find(
      (segment) => segment.representations.labelmap?.labelValue === labelValue
    );
  }

  function registerArtifact(labelmap: vtkLabelMap, meta: ArtifactMetadata) {
    const id = useIdStore().nextId();
    artifactIndex[id] = markRaw(labelmap);
    artifactMeta[id] = { ...meta };
    artifactOrderByParent[meta.parentImage] ??= [];
    artifactOrderByParent[meta.parentImage].push(id);
    return id;
  }

  /** Allocates an empty labelmap shaped like the parent image. */
  function createArtifactForImage(parentImageId: string) {
    const imageData = imageCacheStore.getVtkImageData(parentImageId);
    if (!imageData) throw new Error('No such parent image');

    const baseName =
      imageCacheStore.getImageMetadata(parentImageId)?.name ?? NO_NAME;
    return registerArtifact(createLabelmapFromImage(imageData), {
      parentImage: parentImageId,
      name: pickUniqueArtifactName(
        (index) => makeDefaultSegmentGroupName(baseName, index),
        parentImageId
      ),
    });
  }

  function updateArtifactMeta(
    artifactId: string,
    patch: Partial<ArtifactMetadata>
  ) {
    const meta = artifactMeta[artifactId];
    if (!meta) throw new Error('No such artifact');
    artifactMeta[artifactId] = { ...meta, ...patch };
  }

  function detachSegment(segmentation: Segmentation, segmentId: string) {
    removeFromArray(segmentation.order, segmentId);
    delete segmentation.segments[segmentId];
  }

  function removeArtifact(artifactId: string) {
    const meta = artifactMeta[artifactId];
    if (!meta) return;

    const segmentation = getSegmentationForImage(meta.parentImage);
    if (segmentation) {
      segmentsForArtifact(artifactId).forEach((segment) =>
        detachSegment(segmentation, segment.id)
      );
    }

    removeFromArray(artifactOrderByParent[meta.parentImage] ?? [], artifactId);
    delete artifactIndex[artifactId];
    delete artifactMeta[artifactId];
  }

  function releaseUnreferencedArtifact(artifactId: string) {
    if (bindingsForArtifact(artifactId).length > 0) return;
    removeArtifact(artifactId);
  }

  /**
   * Replaces an artifact's segment catalog with one segment per given label
   * value. Voxels are untouched: this is a catalog operation.
   */
  function setArtifactSegments(
    artifactId: string,
    descriptors: LabelmapSegment[]
  ) {
    const meta = artifactMeta[artifactId];
    if (!meta) throw new Error('No such artifact');

    const segmentation = ensureSegmentationForImage(meta.parentImage);
    segmentsForArtifact(artifactId).forEach((segment) =>
      detachSegment(segmentation, segment.id)
    );

    const extent = fullExtent(artifactIndex[artifactId].getDimensions());
    descriptors.forEach((descriptor) => {
      const segment = createSegment(segmentation.id, {
        name: descriptor.name,
        color: [...descriptor.color] as RGBAColor,
      });
      segment.visible = descriptor.visible;
      segment.locked = descriptor.locked ?? false;
      segment.representations.labelmap = {
        artifactId,
        labelValue: descriptor.value,
        extent,
      };
    });

    return segmentsForArtifact(artifactId);
  }

  /** The single voxel-allocation point: no other operation creates storage. */
  function ensureLabelmapBinding(
    segmentationId: string,
    segmentId: string,
    preferredArtifactId?: string
  ) {
    const segment = getSegment(segmentationId, segmentId);
    if (segment.representations.labelmap)
      return segment.representations.labelmap;

    const segmentation = getSegmentation(segmentationId);
    const artifactId =
      preferredArtifactId ??
      listSegments(segmentation).find((other) => other.representations.labelmap)
        ?.representations.labelmap?.artifactId ??
      createArtifactForImage(segmentation.parentImageId);

    const used = new Set(
      bindingsForArtifact(artifactId).map((binding) => binding.labelValue)
    );
    let labelValue = LABELMAP_BACKGROUND_VALUE + 1;
    while (used.has(labelValue)) labelValue += 1;

    segment.representations.labelmap = {
      artifactId,
      labelValue,
      extent: fullExtent(artifactIndex[artifactId].getDimensions()),
    };
    return segment.representations.labelmap;
  }

  function resolveLabelmapBinding(segmentationId: string, segmentId: string) {
    const binding = getSegment(segmentationId, segmentId).representations
      .labelmap;
    if (!binding) return undefined;
    return { ...toRaw(binding), labelmap: artifactIndex[binding.artifactId] };
  }

  function updateSegment(
    segmentationId: string,
    segmentId: string,
    patch: SegmentPatch
  ) {
    const segmentation = getSegmentation(segmentationId);
    segmentation.segments[segmentId] = {
      ...toRaw(getSegment(segmentationId, segmentId)),
      ...patch,
    };
  }

  function reorderSegments(segmentationId: string, order: string[]) {
    getSegmentation(segmentationId).order = [...order];
  }

  function deleteSegment(segmentationId: string, segmentId: string) {
    const segmentation = getSegmentation(segmentationId);
    const binding = getSegment(segmentationId, segmentId).representations
      .labelmap;

    detachSegment(segmentation, segmentId);

    if (!binding) return;
    artifactIndex[binding.artifactId]?.replaceLabelValue(
      binding.labelValue,
      LABELMAP_BACKGROUND_VALUE
    );
    releaseUnreferencedArtifact(binding.artifactId);
  }

  function removeSegmentation(segmentationId: string) {
    const segmentation = segmentations[segmentationId];
    if (!segmentation) return;

    const { parentImageId } = segmentation;
    delete byParentImage[parentImageId];
    delete segmentations[segmentationId];

    removeArtifactsForImage(parentImageId);
  }

  function removeArtifactsForImage(parentImageId: string) {
    [...artifactsForImage(parentImageId)].forEach(removeArtifact);
    delete artifactOrderByParent[parentImageId];
  }

  // --- active target and cross-image intent --- //

  const activeTargetRef = shallowRef<Maybe<ActiveSegmentationTarget>>();

  // Session-only, never serialized: which segment the user means, and where
  // that intent has already landed per image.
  let intent: Maybe<ActiveSegmentIntent>;

  const segmentAt = (target: ActiveSegmentationTarget) =>
    segmentations[target.segmentationId]?.segments[target.segmentId];

  // A target whose segment is gone (deleted, or its catalog replaced) is none.
  const activeTarget = computed(() =>
    activeTargetRef.value && segmentAt(activeTargetRef.value)
      ? activeTargetRef.value
      : undefined
  );

  function setActiveSegment(segmentationId: string, segmentId: string) {
    const segment = getSegment(segmentationId, segmentId);
    const target = { segmentationId, segmentId };
    const imageId = getSegmentation(segmentationId).parentImageId;

    // Reselecting where the intent already landed restates the same intent, so
    // the other images keep their records and a later edit there reuses the
    // clone instead of making a second one.
    const landed = intent?.targetByImageId;
    const here = landed?.[imageId];
    const sameIntent =
      here?.segmentationId === segmentationId && here?.segmentId === segmentId;

    intent = {
      name: segment.name,
      color: [...segment.color] as RGBAColor,
      targetByImageId: sameIntent
        ? { ...landed, [imageId]: target }
        : { [imageId]: target },
    };
    activeTargetRef.value = target;
  }

  function clearActiveSegment() {
    intent = undefined;
    activeTargetRef.value = undefined;
  }

  /** The artifact the active segment writes into, once it has storage. */
  const activeArtifactId = computed(() => {
    const target = activeTarget.value;
    if (!target) return undefined;
    return segmentAt(target)?.representations.labelmap?.artifactId;
  });

  /**
   * The one entry point every edit path calls at operation time. Only this
   * creates a segment; setting an active segment or viewing another image
   * never does. Storage stays deferred to ensureLabelmapBinding.
   */
  /** Whether a segment id is live anywhere, used to tell stale ids from foreign ones. */
  const segmentExists = (segmentId: string) =>
    Object.values(segmentations).some(
      (segmentation) => segmentId in segmentation.segments
    );

  function resolveEditTarget(
    imageId: string,
    preferredSegmentId?: Maybe<string>
  ) {
    // An explicit segment wins when it belongs to this image. Anything else, a
    // stale id included, falls through to the normal path. This does not change
    // the active segment: naming a segment to edit is not selecting it.
    if (preferredSegmentId) {
      const owner = getSegmentationForImage(imageId);
      if (owner?.segments[preferredSegmentId]) {
        return { segmentationId: owner.id, segmentId: preferredSegmentId };
      }
    }

    const recorded = intent?.targetByImageId[imageId];
    if (recorded && segmentAt(recorded)) {
      activeTargetRef.value = recorded;
      return recorded;
    }

    // Identity is copied, never matched: a same-named segment is not the same
    // segment.
    const { name, color } = intent ?? DEFAULT_SEGMENT_MASKS[0];
    const segmentation = ensureSegmentationForImage(imageId);
    const segment = createSegment(segmentation.id, { name, color });
    const target = { segmentationId: segmentation.id, segmentId: segment.id };
    intent = {
      name,
      color: [...color] as RGBAColor,
      targetByImageId: { ...intent?.targetByImageId, [imageId]: target },
    };
    activeTargetRef.value = target;
    return target;
  }

  // --- render sync --- //

  // The labelmap renderer colors by voxel value, so each artifact receives the
  // value-keyed projection of the segments bound to it.
  const labelmapSegmentsByArtifact = computed(() => {
    const byArtifact: Record<string, LabelmapSegment[]> = {};
    Object.keys(artifactMeta).forEach((artifactId) => {
      byArtifact[artifactId] = [];
    });
    Object.values(segmentations).forEach((segmentation) => {
      listSegments(segmentation).forEach((segment) => {
        const binding = segment.representations.labelmap;
        if (!binding || !byArtifact[binding.artifactId]) return;
        byArtifact[binding.artifactId].push({
          value: binding.labelValue,
          name: segment.name,
          color: [...segment.color] as RGBAColor,
          visible: segment.visible,
          locked: segment.locked,
        });
      });
    });
    return byArtifact;
  });

  watch(
    labelmapSegmentsByArtifact,
    (byArtifact) => {
      Object.entries(byArtifact).forEach(([artifactId, segments]) => {
        artifactIndex[artifactId]?.setSegments(segments);
      });
    },
    { immediate: true }
  );

  // --- state file --- //

  async function serialize(
    state: StateFile,
    io: SegmentationArtifactIO = defaultArtifactIO
  ) {
    const { zip, manifest } = state;
    const format = useSegmentGroupStore().saveFormat;
    const usedArchivePaths = new Set<string>();

    // Artifact order per parent image is implicitly preserved by the order of
    // the serialized entries.
    const entries = Object.keys(artifactOrderByParent).flatMap(
      (parentImageId) =>
        artifactsForImage(parentImageId).map((artifactId) => ({
          artifactId,
          meta: artifactMeta[artifactId],
          path: makeSegmentGroupArchivePath(
            artifactMeta[artifactId].name,
            format,
            usedArchivePaths
          ),
        }))
    );

    manifest.segmentationArtifacts = entries.map(
      ({ artifactId, meta, path }) => ({
        id: artifactId,
        parentImage: meta.parentImage,
        name: meta.name,
        path,
        ...(meta.source ? { source: meta.source } : {}),
      })
    );

    const target = activeTarget.value;
    manifest.segmentations = Object.values(segmentations).map(
      (segmentation) => ({
        id: segmentation.id,
        name: segmentation.name,
        parentImage: segmentation.parentImageId,
        fillOpacity: segmentation.fillOpacity,
        outlineOpacity: segmentation.outlineOpacity,
        outlineThickness: segmentation.outlineThickness,
        segments: listSegments(segmentation).map((segment) => {
          const binding = segment.representations.labelmap;
          return {
            id: segment.id,
            name: segment.name,
            color: [...segment.color] as RGBAColor,
            visible: segment.visible,
            locked: segment.locked,
            fillOpacity: segment.fillOpacity,
            outlineOpacity: segment.outlineOpacity,
            representations: binding
              ? {
                  labelmap: {
                    artifactId: binding.artifactId,
                    labelValue: binding.labelValue,
                    extent: [...binding.extent] as Extent3D,
                  },
                }
              : {},
          };
        }),
        order: [...segmentation.order],
        ...(target?.segmentationId === segmentation.id
          ? { activeSegment: target.segmentId }
          : {}),
      })
    );

    await Promise.all(
      entries.map(async ({ artifactId, path }) => {
        zip.file(
          path,
          await io.write(
            format,
            artifactIndex[artifactId],
            labelmapSegmentsByArtifact.value[artifactId] ?? []
          )
        );
      })
    );
  }

  async function deserialize(
    manifest: Manifest,
    stateFiles: FileEntry[],
    dataIDMap: Record<string, string>,
    // Per-artifact restore source, resolved by the restore setup (see
    // resolveArtifactRestoreSources in restoreStateFile.ts, the single owner of
    // the synthesized-leaf and ownership policy). Mapped through dataIDMap here.
    artifactSources: Record<string, ArtifactRestoreSource> = {},
    io: SegmentationArtifactIO = defaultArtifactIO
  ) {
    const wireArtifacts = manifest.segmentationArtifacts ?? [];
    const artifactIdMap: Record<string, string> = {};
    const segmentIdMap: Record<string, string> = {};
    // Non-silent drops: every artifact left out of the restore is recorded with
    // a concrete reason so the caller can surface it.
    const skipped: Array<{ name: string; reason: string }> = [];

    // A path-less artifact's store id: the restore setup already resolved which
    // STATE id carries its bytes; this only maps that id through dataIDMap.
    const artifactStoreId = (artifact: SegmentationArtifact) => {
      if (artifact.path !== undefined) return undefined;
      const source = artifactSources[artifact.id];
      return source !== undefined ? dataIDMap[source.stateId] : undefined;
    };

    // `path` is authoritative for bytes when present: a re-saved zip carries the
    // archive bytes AND the provenance `dataSourceId`, but `dataIDMap` is keyed
    // by save-time DATASET ids.
    async function loadArtifactImage(
      artifact: SegmentationArtifact,
      storeId: string | undefined
    ) {
      if (artifact.path !== undefined) {
        const file = stateFiles.find(
          (entry) => entry.archivePath === normalize(artifact.path!)
        )?.file;
        return io.read(file!);
      }

      await untilLoaded(storeId!);
      const image = imageCacheStore.getVtkImageData(storeId!);
      if (!image) {
        throw new Error(
          `Could not get image data for dataSourceId ${artifact.dataSourceId}`
        );
      }
      return {
        image,
        headerMetadata: imageCacheStore.imageById[storeId!]?.headerMetadata,
      };
    }

    // Skip BEFORE awaiting anything an artifact whose parent image is
    // unresolved, or a path-less one whose datasource never materialized —
    // `untilLoaded(undefined)` never times out and would hang restore forever.
    const attachable = wireArtifacts.filter((artifact) => {
      if (dataIDMap[artifact.parentImage] === undefined) {
        skipped.push({
          name: artifact.name,
          reason: 'parent image did not load',
        });
        return false;
      }
      if (artifact.path !== undefined) return true;
      const hasArtifact = artifactStoreId(artifact) !== undefined;
      if (!hasArtifact) {
        skipped.push({
          name: artifact.name,
          reason: 'artifact source unavailable',
        });
      }
      return hasArtifact;
    });

    // Every path-less artifact's temporary imported dataset must be removed
    // exactly ONCE, and only AFTER every artifact that reads it has settled;
    // two artifacts sharing a dataSourceId share one temp dataset id. Collected
    // from EVERY artifact, not just the attachable ones: one skipped at the
    // parent-image check may still have imported its leaf.
    const tempStoreIdsToRemove = new Set(
      wireArtifacts
        .filter((artifact) => artifactSources[artifact.id]?.temporary === true)
        .map(artifactStoreId)
        .filter((storeId): storeId is string => storeId !== undefined)
    );

    let loaded;
    try {
      loaded = await Promise.all(
        attachable.map(async (artifact) => {
          const storeId = artifactStoreId(artifact);
          try {
            const { image, headerMetadata } = await loadArtifactImage(
              artifact,
              storeId
            );
            const labelmap = toLabelMap(image);
            // A migrated group that carried no descriptors is enumerated here,
            // through the same decode live import uses, while its source image
            // is still loaded: the temp artifact dataset is dropped below.
            const decoded = artifact.pendingDecode
              ? ((await useSegmentGroupStore().decodeSegments(
                  storeId,
                  labelmap,
                  0,
                  headerMetadata
                )) as LabelmapSegment[])
              : undefined;
            return { artifact, labelmap, decoded };
          } catch {
            // A parse/read failure skips just this artifact — never rejects the
            // whole restore; the survivors still attach.
            skipped.push({
              name: artifact.name,
              reason: 'could not read/parse labelmap',
            });
            return undefined;
          }
        })
      );
    } finally {
      const datasetStore = useDatasetStore();
      tempStoreIdsToRemove.forEach((storeId) => datasetStore.remove(storeId));
    }

    loaded.forEach((result) => {
      if (!result) return;
      const { artifact, labelmap } = result;
      artifactIdMap[artifact.id] = registerArtifact(labelmap, {
        parentImage: dataIDMap[artifact.parentImage],
        name: artifact.name,
        ...(artifact.source ? { source: artifact.source } : {}),
      });
    });

    (manifest.segmentations ?? []).forEach((wire) => {
      const parentImageId = dataIDMap[wire.parentImage];
      if (parentImageId === undefined) return;

      const segmentation = ensureSegmentationForImage(parentImageId);
      segmentation.name = wire.name;
      segmentation.fillOpacity = wire.fillOpacity;
      segmentation.outlineOpacity = wire.outlineOpacity;
      segmentation.outlineThickness = wire.outlineThickness;

      const wireById = new Map(
        wire.segments.map((segment) => [segment.id, segment])
      );
      wire.order.forEach((wireSegmentId) => {
        const wireSegment = wireById.get(wireSegmentId);
        if (!wireSegment) return;

        const segment = createSegment(segmentation.id, {
          name: wireSegment.name,
          color: [...wireSegment.color] as RGBAColor,
        });
        segment.visible = wireSegment.visible;
        segment.locked = wireSegment.locked;
        segment.fillOpacity = wireSegment.fillOpacity;
        segment.outlineOpacity = wireSegment.outlineOpacity;

        const binding = wireSegment.representations.labelmap;
        const artifactId = binding
          ? artifactIdMap[binding.artifactId]
          : undefined;
        if (binding && artifactId !== undefined) {
          segment.representations.labelmap = {
            artifactId,
            labelValue: binding.labelValue,
            // A migrated binding carries an empty placeholder extent: only the
            // loaded artifact knows the real one.
            extent: isEmptyExtent(binding.extent as Extent3D)
              ? fullExtent(artifactIndex[artifactId].getDimensions())
              : ([...binding.extent] as Extent3D),
          };
        }
        segmentIdMap[wireSegmentId] = segment.id;
      });

      const activeSegmentId = wire.activeSegment
        ? segmentIdMap[wire.activeSegment]
        : undefined;
      if (activeSegmentId !== undefined)
        setActiveSegment(segmentation.id, activeSegmentId);
    });

    // Catalogued after the wire segmentations so a decoded artifact's segments
    // follow the ones the manifest named, not precede them.
    loaded.forEach((result) => {
      if (!result?.decoded) return;
      const artifactId = artifactIdMap[result.artifact.id];
      const created = setArtifactSegments(artifactId, result.decoded);

      // A migrated legacy group carried its active paint value here, because
      // its segments did not exist when activeSegment was applied above.
      const pendingActive = (result.artifact as { pendingActiveValue?: number })
        .pendingActiveValue;
      if (pendingActive === undefined) return;
      const segmentation = getSegmentationForArtifact(artifactId);
      const active = created.find(
        (segment) =>
          segment.representations.labelmap?.labelValue === pendingActive
      );
      if (segmentation && active) setActiveSegment(segmentation.id, active.id);
    });

    return { artifactIdMap, segmentIdMap, skipped };
  }

  // --- handle deletions --- //

  onImageDeleted((deleted) => {
    deleted.forEach((parentImageId) => {
      delete nextDefaultIndex[parentImageId];
      const id = byParentImage[parentImageId];
      if (id) removeSegmentation(id);
      else removeArtifactsForImage(parentImageId);
    });
  });

  return {
    segmentations,
    byParentImage,
    artifactIndex,
    artifactMeta,
    artifactOrderByParent,
    labelmapSegmentsByArtifact,
    activeTarget,
    activeArtifactId,
    setActiveSegment,
    clearActiveSegment,
    resolveEditTarget,
    segmentExists,
    getSegmentationForImage,
    ensureSegmentationForImage,
    getSegment,
    resolveLabelmapBinding,
    createSegment,
    ensureLabelmapBinding,
    updateSegment,
    reorderSegments,
    deleteSegment,
    removeSegmentation,
    artifactsForImage,
    getSegmentationForArtifact,
    segmentsForArtifact,
    findSegmentByLabelValue,
    registerArtifact,
    createArtifactForImage,
    updateArtifactMeta,
    setArtifactSegments,
    removeArtifact,
    pickUniqueArtifactName,
    serialize,
    deserialize,
  };
});
