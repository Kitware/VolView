import { defineStore } from 'pinia';
import { markRaw, reactive, ref, toRaw } from 'vue';
import type { RGBAColor } from '@kitware/vtk.js/types';

import { CATEGORICAL_COLORS } from '@/src/config';
import { NO_NAME } from '@/src/constants';
import { createArtifactNamer } from '@/src/store/artifactNaming';
import {
  LABELMAP_MAX_VALUE,
  nextUnusedLabelValue,
} from '@/src/store/segmentLabelValue';
import { allocateMask } from '@/src/store/segmentMask';
import {} from '@/src/store/segmentationRestore';
import { groupByLayer, writeMaskInto } from '@/src/store/segmentLayers';
import { createSegmentProjection } from '@/src/store/segmentProjection';
import { createVoxelAccess } from '@/src/store/segmentVoxelAccess';
import {
  createSegmentationWire,
  type SegmentationArtifactIO,
} from '@/src/store/segmentationWire';

export type { SegmentationArtifactIO };
export type { ArtifactMetadata };
export { LABELMAP_MAX_VALUE };
import { onImageDeleted } from '@/src/composables/onImageDeleted';
import { declareManifestRefs } from '@/src/core/manifestRefs';
import {
  decodeLabelmapSegments,
  importLabelmapImage,
  splitLabelmap,
} from '@/src/io/labelmapImport';
import type {} from '@/src/io/state-file/schema';
import { useIdStore } from '@/src/store/id';
import { useImageCacheStore } from '@/src/store/image-cache';
import type { Maybe, ProcessingResultSource } from '@/src/types';
import {
  type DataSelection,
  getSelectionStem,
} from '@/src/utils/dataSelection';
import {
  DEFAULT_SEGMENTATION_FILL_OPACITY,
  emptyExtent,
  fullExtent,
  isEmptyExtent,
  listMasks,
  maskScalars,
  type Extent3D,
  type LabelmapSegment,
  type ArtifactMetadata,
  type SegmentMask,
  type Segmentation,
  type SegmentationDisplayPatch,
} from '@/src/types/segmentation';
import { toLabelmapSegment } from '@/src/types/segment';
import { useSegmentStore } from '@/src/store/segments';
import { declareSegmentReferences } from '@/src/store/tools/segmentReferences';
import { cleanUndefined, isRecord, removeFromArray } from '@/src/utils';
import { cycleColors } from '@/src/utils/color';
import vtkLabelMap from '@/src/vtk/LabelMap';

/**
 * What a write path is doing to the voxels it touches, which is what decides
 * whether it may take one a neighbouring segment already holds.
 *
 * `aimed` is a gesture the user pointed at a place: paint and polygon CLAIM the
 * voxel, clearing it from every unlocked neighbour, so the write always lands.
 * Masks are per segment, so an aimed write clears its neighbours itself. A locked
 * segment is not editable and losing a voxel is an edit, so it keeps the voxel
 * and the two segments overlap: locking is the whole opt-in for overlap.
 *
 * `sweep` is a run the user aimed at no place at all: Fill Holes, Fill Between
 * and Smooth pass over whatever the segment already covers, so they write into
 * empty space only and take nothing from a neighbour, locked or not.
 *
 * A new write path picks its policy by saying which of the two it is. Boolean
 * subtract, scissors and a threshold grow are aimed; a result written over a
 * whole volume, such as an ML segmentation, is a sweep.
 */
export type VoxelGesture = 'aimed' | 'sweep';

/**
 * The labelmap codec the state file writes through. Injected because itk-wasm
 * and the vti worker have no node counterpart.
 */

export type { ImportedSegment } from '@/src/io/labelmapImport';

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
      const masks = Array.isArray(raw.masks) ? raw.masks : [];
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
        ...masks.flatMap((mask, maskIndex) => {
          const binding = isRecord(mask)
            ? (mask.representations as Record<string, unknown> | undefined)
                ?.labelmap
            : undefined;
          return [
            ...(isRecord(mask) && typeof mask.segmentId === 'string'
              ? [
                  {
                    kind: 'segment' as const,
                    id: mask.segmentId,
                    where: `${where}.masks[${maskIndex}].segmentId`,
                  },
                ]
              : []),
            ...(isRecord(binding) && typeof binding.artifactId === 'string'
              ? [
                  {
                    kind: 'segmentationArtifact' as const,
                    id: binding.artifactId,
                    where: `${where}.masks[${maskIndex}].representations.labelmap.artifactId`,
                  },
                ]
              : []),
          ];
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
  const segmentRegistry = useSegmentStore().segments;

  const segmentations = reactive<Record<string, Segmentation>>({});
  // Internal storage layer: UI and tools reach it through this store's API only.
  const artifactIndex = reactive<Record<string, vtkLabelMap>>({});
  const artifactMeta = reactive<Record<string, ArtifactMetadata>>({});
  const artifactNamer = createArtifactNamer(
    () => new Set(Object.values(artifactMeta).map((meta) => meta.name))
  );

  function getSegmentation(segmentationId: string) {
    const segmentation = segmentations[segmentationId];
    if (!segmentation) throw new Error('No such segmentation');
    return segmentation;
  }

  // SegmentMask ids are globally unique and one segmentation per image is
  // enforced, so a segment addresses itself; the segmentation is looked up.
  const segmentationOfMask = (maskId: string) =>
    Object.values(segmentations).find(
      (segmentation) => maskId in segmentation.masks
    );

  const findMask = (maskId: string) =>
    segmentationOfMask(maskId)?.masks[maskId];

  function getSegmentationOfMask(maskId: string) {
    const segmentation = segmentationOfMask(maskId);
    if (!segmentation) throw new Error('No such segment');
    return segmentation;
  }

  function getMask(maskId: string) {
    const segment = findMask(maskId);
    if (!segment) throw new Error('No such segment');
    return segment;
  }

  const getSegmentationForImage = (parentImageId: string) =>
    Object.values(segmentations).find(
      (segmentation) => segmentation.parentImageId === parentImageId
    );

  function ensureSegmentationForImage(parentImageId: string) {
    const existing = getSegmentationForImage(parentImageId);
    if (existing) return existing;

    const id = useIdStore().nextId();
    segmentations[id] = {
      id,
      name: imageCacheStore.getImageMetadata(parentImageId)?.name ?? NO_NAME,
      parentImageId,
      masks: {},
      order: [],
      fillOpacity: DEFAULT_SEGMENTATION_FILL_OPACITY,
      outlineOpacity: 1,
      outlineThickness: 2,
    };
    return segmentations[id];
  }

  /** One mask per (image, segment); the caller has checked there is none. */
  function createMask(segmentationId: string, segmentId: string) {
    const segmentation = getSegmentation(segmentationId);
    const id = useIdStore().nextId();
    segmentation.masks[id] = { id, segmentId, representations: {} };
    segmentation.order.push(id);
    return segmentation.masks[id];
  }

  function getSegmentationForArtifact(artifactId: string) {
    const parentImage = artifactMeta[artifactId]?.parentImage;
    return parentImage ? getSegmentationForImage(parentImage) : undefined;
  }

  /** The ordered segments whose labelmap binding points at one artifact. */
  function masksForArtifact(artifactId: string) {
    const segmentation = getSegmentationForArtifact(artifactId);
    if (!segmentation) return [];
    return listMasks(segmentation).filter(
      (segment) => segment.representations.labelmap?.artifactId === artifactId
    );
  }

  function registerArtifact(labelmap: vtkLabelMap, meta: ArtifactMetadata) {
    const id = useIdStore().nextId();
    artifactIndex[id] = markRaw(labelmap);
    artifactMeta[id] = { ...meta };
    return id;
  }

  /**
   * Allocates a mask on the parent's grid that covers nothing yet. `name` is
   * the name a manifest carried: it reaches the saved zip's entry path and the
   * artifact list, so a restore that generated one instead would rename the
   * file on every round trip. Duplicates are fine, serialize resolves the
   * archive path against the ones it has already used.
   */
  function createArtifactForImage(
    parentImageId: string,
    extent: Extent3D = emptyExtent(),
    source?: ProcessingResultSource,
    name?: string
  ) {
    const imageData = imageCacheStore.getVtkImageData(parentImageId);
    if (!imageData) throw new Error('No such parent image');

    const baseName =
      imageCacheStore.getImageMetadata(parentImageId)?.name ?? NO_NAME;
    return registerArtifact(allocateMask(imageData, extent), {
      parentImage: parentImageId,
      name: name ?? artifactNamer.pick(parentImageId, baseName),
      ...(source ? { source } : {}),
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

  function detachMask(segmentation: Segmentation, maskId: string) {
    removeFromArray(segmentation.order, maskId);
    delete segmentation.masks[maskId];
  }

  function removeArtifact(artifactId: string) {
    const meta = artifactMeta[artifactId];
    if (!meta) return;

    const segmentation = getSegmentationForImage(meta.parentImage);
    if (segmentation) {
      masksForArtifact(artifactId).forEach((segment) =>
        detachMask(segmentation, segment.id)
      );
    }

    delete artifactIndex[artifactId];
    delete artifactMeta[artifactId];
  }

  /**
   * Label values stay unique among the segments of one parent image, and have
   * to fit in a mask byte. Exhausting them refuses the allocation rather than
   * handing back a value that writes as background.
   */
  function nextLabelValue(segmentation: Segmentation, preferred?: number) {
    const used = new Set(
      listMasks(segmentation).flatMap((segment) =>
        segment.representations.labelmap
          ? [segment.representations.labelmap.labelValue]
          : []
      )
    );
    return nextUnusedLabelValue(used, LABELMAP_MAX_VALUE, preferred);
  }

  /** A mask is editable when the segment it delineates is unlocked. */
  const maskLocked = (mask: SegmentMask) =>
    segmentRegistry.appearanceOf(mask.segmentId).locked;

  const isLocked = (maskId: string) =>
    segmentRegistry.appearanceOf(findMask(maskId)?.segmentId).locked;

  /**
   * The segment a file's descriptor binds to: the one already carrying that
   * exact name, or a new one minted from the file. The registry's own color wins
   * on a match. A name already taken on this image mints a suffixed segment
   * instead, since one image holds at most one mask per segment.
   */
  function bindDescriptorSegment(
    parentImageId: string,
    descriptor: LabelmapSegment,
    preferredSegmentId?: Maybe<string>
  ) {
    const usable = (segmentId: Maybe<string>) =>
      !!segmentId &&
      !!segmentRegistry.getSegment(segmentId) &&
      !maskFor(parentImageId, segmentId);
    if (usable(preferredSegmentId)) return preferredSegmentId!;
    const existing = segmentRegistry.findSegmentByName(descriptor.name);
    if (existing && usable(existing.id)) return existing.id;
    // A minted segment takes the file's whole description; a matched one keeps
    // what the registry already says, its visibility and lock included.
    return segmentRegistry.mintSegment({
      name: segmentRegistry.uniqueName(descriptor.name),
      color: [...descriptor.color] as RGBAColor,
      visible: descriptor.visible,
      locked: descriptor.locked ?? false,
      ...cleanUndefined({
        fillOpacity: descriptor.fillOpacity,
        outlineOpacity: descriptor.outlineOpacity,
      }),
    });
  }

  /**
   * Mints one mask per descriptor and fills it. The masks
   * share one segmentation, so label values are assigned against what is
   * already in it and a taken value gets remapped.
   */
  function splitLabelmapIntoMasks(
    parentImageId: string,
    labelmap: vtkLabelMap,
    descriptors: LabelmapSegment[],
    options: {
      source?: ProcessingResultSource;
      artifactName?: string;
      // The type a descriptor already belongs to, for a split that replaces
      // masks rather than importing a file.
      segmentIdFor?: (descriptor: LabelmapSegment) => Maybe<string>;
    } = {}
  ) {
    const segmentation = ensureSegmentationForImage(parentImageId);
    const created: SegmentMask[] = [];

    splitLabelmap(labelmap, descriptors, (descriptor, extent) => {
      // Claimed before the segment exists: exhausting the values throws, and a
      // segment minted first would be left in the list with no mask.
      const labelValue = nextLabelValue(segmentation, descriptor.value);
      const segment = createMask(
        segmentation.id,
        bindDescriptorSegment(
          parentImageId,
          descriptor,
          options.segmentIdFor?.(descriptor)
        )
      );

      const artifactId = createArtifactForImage(
        parentImageId,
        extent,
        options.source,
        options.artifactName
      );
      segment.representations.labelmap = { artifactId, labelValue, extent };
      created.push(segment);

      return { labelValue, mask: maskScalars(artifactIndex[artifactId]) };
    });

    return created;
  }

  // Deliberately separate from createMask's cursor: a descriptor-less
  // labelmap must decode to the same catalog whether it came from a cold
  // restore or a live conversion, regardless of how many segments this
  // session has otherwise created.
  const getNextDecodeColor = cycleColors(CATEGORICAL_COLORS);

  function decodeSegments(
    imageId: DataSelection | undefined,
    image: vtkLabelMap,
    options: { component?: number; headerMetadata?: Map<string, string> } = {}
  ) {
    return decodeLabelmapSegments(imageId, image, {
      ...options,
      // A descriptor-less labelmap reads as the file it arrived in, not as
      // 'Segment N'; the cold restore decodes through here too, so the two
      // paths keep naming one labelmap alike.
      baseName: imageId === undefined ? undefined : getSelectionStem(imageId),
      nextColor: getNextDecodeColor,
    });
  }

  function convertImageToLabelmap(
    imageID: DataSelection,
    parentID: DataSelection,
    source?: ArtifactMetadata['source']
  ) {
    return importLabelmapImage(imageID, parentID, {
      decode: (labelmap, component) =>
        decodeSegments(imageID, labelmap, { component }) as Promise<
          LabelmapSegment[]
        >,
      split: (labelmap, descriptors) =>
        splitLabelmapIntoMasks(parentID, labelmap, descriptors, {
          source,
        }).map((segment) => segment.id),
    });
  }

  const saveFormat = ref('vti');

  /** The single voxel-allocation point: no other operation creates storage. */
  function ensureLabelmapBinding(maskId: string) {
    const segmentation = getSegmentationOfMask(maskId);
    const segment = segmentation.masks[maskId];
    if (segment.representations.labelmap)
      return segment.representations.labelmap;

    // The value is claimed before the mask exists: exhausting the values throws,
    // and an artifact minted first would outlive the refused binding.
    const labelValue = nextLabelValue(segmentation);
    segment.representations.labelmap = {
      artifactId: createArtifactForImage(segmentation.parentImageId),
      labelValue,
      extent: emptyExtent(),
    };
    return segment.representations.labelmap;
  }

  /** The binding of a segment that may already be gone. */
  const findMaskBinding = (maskId: string) =>
    findMask(maskId)?.representations.labelmap;

  /**
   * A copy of a segment's binding, or undefined when it has none. No live
   * buffer travels with it: the copied extent would go stale beside one.
   */
  function resolveLabelmapBinding(maskId: string) {
    const binding = getMask(maskId).representations.labelmap;
    if (!binding) return undefined;
    return { ...toRaw(binding) };
  }

  const { maskVoxels, artifactVoxels, boundedMask, voxelClaim } =
    createVoxelAccess({
      artifactIndex,
      artifactMeta,
      imageCacheStore,
      segmentRegistry,
      findMask,
      getMask,
      masksForArtifact,
      segmentationOfMask,
      ensureLabelmapBinding,
      maskLocked,
    });

  /** The image's segments in `order`, or none when it has no segmentation. */
  function imageMasks(parentImageId: string) {
    const segmentation = getSegmentationForImage(parentImageId);
    return segmentation ? listMasks(segmentation) : [];
  }

  /**
   * The given segments as one parent-shaped labelmap, built on demand and never
   * stored: what leaves VolView means the whole segmentation, not one segment's
   * bounded mask. Later in the registry wins where two segments overlap, which
   * is the order their actors stack in, so the flattened file resolves an
   * overlap the way the screen did. `members` defaults to the image's segments;
   * an export passes one group so no overlap is flattened away.
   */
  function compositeLabelmap(parentImageId: string, members?: SegmentMask[]) {
    const parent = imageCacheStore.getVtkImageData(parentImageId);
    if (!parent) throw new Error('No such parent image');

    const dimensions = parent.getDimensions();
    const labelmap = allocateMask(parent, fullExtent(dimensions));
    const values = maskScalars(labelmap);

    const included = [...(members ?? imageMasks(parentImageId))].sort(
      (first, second) =>
        segmentRegistry.orderIndexOf(first.segmentId) -
        segmentRegistry.orderIndexOf(second.segmentId)
    );
    const used = new Set(
      included.flatMap((segment) => {
        const binding = segment.representations.labelmap;
        return binding ? [binding.labelValue] : [];
      })
    );
    const segments: LabelmapSegment[] = [];
    included.forEach((segment) => {
      const binding = segment.representations.labelmap;
      const labelValue =
        binding?.labelValue ?? nextUnusedLabelValue(used, LABELMAP_MAX_VALUE);
      used.add(labelValue);
      segments.push(
        toLabelmapSegment(
          segmentRegistry.getSegment(segment.segmentId),
          labelValue
        )
      );
      if (!binding) return;
      const bounded = boundedMask(binding);
      if (bounded) writeMaskInto(values, dimensions, bounded);
    });

    return { labelmap, segments };
  }

  /**
   * The image's segments grouped so no group holds an overlap. A labelmap file
   * carries one label per voxel, so an export writes a file per group. Always
   * at least one group: an image with no segments still exports one file.
   */
  function layeredSegments(parentImageId: string) {
    const groups = groupByLayer(imageMasks(parentImageId), (segment) =>
      boundedMask(segment.representations.labelmap)
    );
    return groups.length ? groups : [[]];
  }

  /**
   * The segments of an image a process may edit: unlocked, since a locked one
   * is not editable, and holding voxels, since an empty mask has no content to
   * process.
   */
  function editableMasks(parentImageId: string) {
    return imageMasks(parentImageId).flatMap((segment) => {
      const binding = segment.representations.labelmap;
      if (maskLocked(segment) || !binding || isEmptyExtent(binding.extent))
        return [];
      return [{ maskId: segment.id, labelValue: binding.labelValue }];
    });
  }

  /**
   * The masks of an image, with their segment's place in the registry: that
   * order is what the renderer offsets by, so two images show one segment at
   * the same depth.
   */
  function maskLayersForImage(parentImageId: string) {
    return imageMasks(parentImageId).flatMap((segment) => {
      const { artifactId } = segment.representations.labelmap ?? {};
      return artifactId
        ? [
            {
              maskId: segment.id,
              artifactId,
              stackIndex: segmentRegistry.orderIndexOf(segment.segmentId),
            },
          ]
        : [];
    });
  }

  const updateSegmentationDisplay = (
    segmentationId: string,
    patch: SegmentationDisplayPatch
  ) => Object.assign(getSegmentation(segmentationId), patch);

  function reorderSegments(segmentationId: string, order: string[]) {
    getSegmentation(segmentationId).order = [...order];
  }

  function deleteMask(maskId: string) {
    const segmentation = getSegmentationOfMask(maskId);
    const binding = segmentation.masks[maskId].representations.labelmap;

    detachMask(segmentation, maskId);

    // The mask holds this segment and nothing else, so it goes with it.
    if (binding) removeArtifact(binding.artifactId);
  }

  function removeSegmentation(segmentationId: string) {
    const segmentation = segmentations[segmentationId];
    if (!segmentation) return;

    const { parentImageId } = segmentation;
    delete segmentations[segmentationId];

    removeArtifactsForImage(parentImageId);
  }

  function removeArtifactsForImage(parentImageId: string) {
    Object.keys(artifactMeta)
      .filter(
        (artifactId) => artifactMeta[artifactId].parentImage === parentImageId
      )
      .forEach(removeArtifact);
  }

  // --- edit targets --- //

  /** This image's mask for a segment, absent when it has none here. */
  const maskFor = (imageId: Maybe<string>, segmentId: Maybe<string>) => {
    if (!imageId || !segmentId) return undefined;
    const segmentation = getSegmentationForImage(imageId);
    return segmentation
      ? listMasks(segmentation).find(
          (segment) => segment.segmentId === segmentId
        )
      : undefined;
  };

  /** The mask for (image, segment). Creates identity only, never voxels. */
  function ensureMask(imageId: string, segmentId: string) {
    const existing = maskFor(imageId, segmentId);
    if (existing) return existing;
    const segmentation = ensureSegmentationForImage(imageId);
    return createMask(segmentation.id, segmentId);
  }

  /** Whether a segment id is live anywhere, used to tell stale ids from foreign ones. */
  const maskExists = (maskId: string) => !!findMask(maskId);

  // A segment the caller named that no longer exists is a stale reference, not
  // a target: the edit falls through to the selected one.
  const liveSegmentId = (segmentId: Maybe<string>) =>
    segmentId && segmentRegistry.getSegment(segmentId) ? segmentId : undefined;

  /**
   * The mask an edit would land in, if it already exists. Creates nothing, so
   * an operation with nothing to allocate for, erasing above all, can refuse
   * before a mask is created.
   */
  function findEditTarget(imageId: string, preferredSegmentId?: Maybe<string>) {
    const segmentId =
      liveSegmentId(preferredSegmentId) ??
      segmentRegistry.selectedSegmentId.value;
    return maskFor(imageId, segmentId)?.id;
  }

  /**
   * Resolves or creates the mask an edit targets. With nothing selected the
   * first edit mints and selects a segment, then takes this image's mask of it.
   */
  function resolveEditTarget(
    imageId: string,
    preferredSegmentId?: Maybe<string>
  ) {
    const segmentId =
      liveSegmentId(preferredSegmentId) ??
      segmentRegistry.ensureSelectedSegment();
    return ensureMask(imageId, segmentId).id;
  }

  /** Every image's mask of a segment, for the referenced-segment deletion. */
  const masksOfSegment = (segmentId: string) =>
    Object.values(segmentations).flatMap((segmentation) =>
      listMasks(segmentation).filter(
        (segment) => segment.segmentId === segmentId
      )
    );

  declareSegmentReferences('labelmaps', {
    has: (segmentId) => masksOfSegment(segmentId).length > 0,
    remove: (segmentId) =>
      masksOfSegment(segmentId).forEach((segment) => deleteMask(segment.id)),
  });

  // --- render sync --- //

  const labelmapSegmentsByArtifact = createSegmentProjection({
    segmentations,
    artifactMeta,
    segmentRegistry,
  });

  // --- state file --- //

  const { serialize, deserialize } = createSegmentationWire({
    segmentations,
    artifactIndex,
    artifactMeta,
    saveFormat,
    imageCacheStore,
    segmentRegistry,
    labelmapSegmentsByArtifact,
    createMask,
    detachMask,
    decodeSegments,
    ensureSegmentationForImage,
    getSegmentationForImage,
    maskFor,
    masksForArtifact,
    nextLabelValue,
    registerArtifact,
    removeArtifact,
    splitLabelmapIntoMasks,
  });

  // --- handle deletions --- //

  onImageDeleted((deleted) => {
    deleted.forEach((parentImageId) => {
      artifactNamer.forget(parentImageId);
      const id = getSegmentationForImage(parentImageId)?.id;
      if (id) removeSegmentation(id);
      else removeArtifactsForImage(parentImageId);
    });
  });

  return {
    segmentations,
    artifactIndex,
    artifactMeta,
    labelmapSegmentsByArtifact,
    maskFor,
    findEditTarget,
    resolveEditTarget,
    maskExists,
    getSegmentationForImage,
    ensureSegmentationForImage,
    getMask,
    resolveLabelmapBinding,
    findMaskBinding,
    maskVoxels,
    artifactVoxels,
    createMask,
    ensureLabelmapBinding,
    isLocked,
    updateSegmentationDisplay,
    reorderSegments,
    deleteMask,
    removeSegmentation,
    getSegmentationForArtifact,
    masksForArtifact,
    registerArtifact,
    createArtifactForImage,
    updateArtifactMeta,
    splitLabelmapIntoMasks,
    decodeSegments,
    convertImageToLabelmap,
    saveFormat,
    voxelClaim,
    compositeLabelmap,
    layeredSegments,
    imageMasks,
    editableMasks,
    maskLayersForImage,
    removeArtifact,
    serialize,
    deserialize,
  };
});
