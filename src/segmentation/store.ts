import { useSegmentationEditsStore } from '@/src/segmentation/editing/coordinator';
import { defineStore } from 'pinia';
import { markRaw, reactive, ref } from 'vue';
import type { RGBAColor } from '@kitware/vtk.js/types';

import { CATEGORICAL_COLORS } from '@/src/config';
import { NO_NAME } from '@/src/constants';
import { createArtifactNamer } from '@/src/segmentation/io/artifactNaming';
import {
  LABELMAP_MAX_VALUE,
  SEGMENT_VALUE,
} from '@/src/segmentation/masks/labelValue';
import { allocateMask } from '@/src/segmentation/masks/storage';
import { createSegmentProjection } from '@/src/segmentation/rendering/projection';
import { createVoxelAccess } from '@/src/segmentation/masks/voxelAccess';
import {
  createSegmentationWire,
  type SegmentationArtifactIO,
} from '@/src/segmentation/io/stateFile';

export type { SegmentationArtifactIO };
export { LABELMAP_MAX_VALUE };
import { onImageDeleted } from '@/src/composables/onImageDeleted';
import { declareManifestRefs } from '@/src/core/manifestRefs';
import {
  decodeLabelmapSegments,
  importLabelmapImage,
  splitLabelmap,
} from '@/src/segmentation/io/import';
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
  isEmptyExtent,
  listMasks,
  maskScalars,
  type Extent3D,
  type LabelmapBinding,
  type LabelmapSegment,
  type SegmentMask,
  type Segmentation,
  type SegmentationDisplayPatch,
} from '@/src/segmentation/model';
import { useSegmentStore } from '@/src/segmentation/segments';
import { declareSegmentReferences } from '@/src/segmentation/segmentReferences';
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

export type { ImportedSegment } from '@/src/segmentation/io/import';

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
            // Only a binding still awaiting an artifact's split names one; a
            // saved mask names an archive entry, which is not a manifest ref.
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
  const edits = useSegmentationEditsStore();
  const imageCacheStore = useImageCacheStore();
  const segmentRegistry = useSegmentStore().segments;

  const segmentations = reactive<Record<string, Segmentation>>({});
  const convertingLabelmaps = reactive(new Set<DataSelection>());
  const allBindings = () =>
    Object.values(segmentations).flatMap((segmentation) =>
      listMasks(segmentation).flatMap((segment) =>
        segment.representations.labelmap
          ? [segment.representations.labelmap]
          : []
      )
    );
  const artifactNamer = createArtifactNamer(
    () => new Set(allBindings().map((binding) => binding.name))
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

  /** Creates one mask per (image, segment), refusing duplicate or dangling identity. */
  function createMask(segmentationId: string, segmentId: string) {
    const segmentation = getSegmentation(segmentationId);
    if (!segmentRegistry.getSegment(segmentId))
      throw new Error('No such segment type');
    if (maskFor(segmentation.parentImageId, segmentId))
      throw new Error('Segment already has a mask on this image');
    const id = useIdStore().nextId();
    segmentation.masks[id] = { id, segmentId, representations: {} };
    segmentation.order.push(id);
    return segmentation.masks[id];
  }

  /**
   * A fresh binding over voxels on the parent's grid, covering `extent`. `name`
   * is the name a manifest carried: it reaches the saved zip's entry path, so a
   * restore that generated one instead would rename the file on every round
   * trip. Duplicates are fine, serialize resolves the archive path against the
   * ones it has already used.
   */
  function createBindingForImage(
    parentImageId: string,
    extent: Extent3D = emptyExtent(),
    source?: ProcessingResultSource,
    name?: string
  ): LabelmapBinding {
    const imageData = imageCacheStore.getVtkImageData(parentImageId);
    if (!imageData) throw new Error('No such parent image');

    const baseName =
      imageCacheStore.getImageMetadata(parentImageId)?.name ?? NO_NAME;
    return {
      image: markRaw(allocateMask(imageData, extent)),
      extent,
      name: name ?? artifactNamer.pick(parentImageId, baseName),
      ...(source ? { source } : {}),
    };
  }

  /** Attaches prepared storage to a mask without exposing its mutable record to importers. */
  function attachMaskBinding(maskId: string, binding: LabelmapBinding) {
    const mask = getMask(maskId);
    if (mask.representations.labelmap)
      throw new Error('Mask already has storage');
    mask.representations.labelmap = {
      ...binding,
      image: markRaw(binding.image),
      extent: [...binding.extent],
    };
    return mask.representations.labelmap;
  }

  /** Drops a mask, and the voxels it held with it. */
  function detachMask(segmentation: Segmentation, maskId: string) {
    edits.beforeEdit();
    removeFromArray(segmentation.order, maskId);
    delete segmentation.masks[maskId];
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
    edits.beforeEdit();
    const segmentation = ensureSegmentationForImage(parentImageId);
    const created: SegmentMask[] = [];

    splitLabelmap(labelmap, descriptors, (descriptor, extent) => {
      const segment = createMask(
        segmentation.id,
        bindDescriptorSegment(
          parentImageId,
          descriptor,
          options.segmentIdFor?.(descriptor)
        )
      );

      const binding = createBindingForImage(
        parentImageId,
        extent,
        options.source,
        options.artifactName
      );
      attachMaskBinding(segment.id, binding);
      created.push(segment);

      // The copy rewrites the source's value, so the mask holds SEGMENT_VALUE
      // whatever the file it came from called this segment.
      return { labelValue: SEGMENT_VALUE, mask: maskScalars(binding.image) };
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

  async function convertImageToLabelmap(
    imageID: DataSelection,
    parentID: DataSelection,
    source?: ProcessingResultSource,
    descriptions: Array<
      Pick<LabelmapSegment, 'value'> & Partial<Omit<LabelmapSegment, 'value'>>
    > = []
  ) {
    const bySourceValue = new Map(
      descriptions.map((descriptor) => [
        descriptor.value,
        cleanUndefined(descriptor),
      ])
    );
    convertingLabelmaps.add(imageID);
    try {
      return await importLabelmapImage(imageID, parentID, {
        decode: (labelmap, component) =>
          decodeSegments(imageID, labelmap, { component }) as Promise<
            LabelmapSegment[]
          >,
        split: (labelmap, descriptors) => {
          const created = splitLabelmapIntoMasks(
            parentID,
            labelmap,
            // Identity is chosen by name, so explicit descriptions must precede
            // binding to a type shared by other images.
            descriptors.map((descriptor) => ({
              ...descriptor,
              ...bySourceValue.get(descriptor.value),
            })),
            { source }
          );
          if (created.length && !segmentRegistry.selectedSegment.value) {
            segmentRegistry.selectSegment(created[0].segmentId);
          }
          return created.map((segment) => segment.id);
        },
      });
    } finally {
      convertingLabelmaps.delete(imageID);
    }
  }

  const saveFormat = ref('vti');

  /** The single voxel-allocation point: no other operation creates storage. */
  function ensureLabelmapBinding(maskId: string) {
    const segmentation = getSegmentationOfMask(maskId);
    const segment = segmentation.masks[maskId];
    if (segment.representations.labelmap)
      return segment.representations.labelmap;

    return attachMaskBinding(
      maskId,
      createBindingForImage(segmentation.parentImageId)
    );
  }

  /** The binding of a segment that may already be gone. */
  const findMaskBinding = (maskId: string) =>
    findMask(maskId)?.representations.labelmap;

  const { maskVoxels, findMaskVoxels, voxelClaim } = createVoxelAccess({
    imageCacheStore,
    findMask,
    getMask,
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
   * The segments of an image a process may edit: unlocked, since a locked one
   * is not editable, and holding voxels, since an empty mask has no content to
   * process.
   */
  function editableMasks(parentImageId: string) {
    return imageMasks(parentImageId).flatMap((segment) => {
      const binding = segment.representations.labelmap;
      if (maskLocked(segment) || !binding || isEmptyExtent(binding.extent))
        return [];
      return [{ maskId: segment.id, labelValue: SEGMENT_VALUE }];
    });
  }

  /**
   * Back-to-front depth for each mask. Earlier registry entries get greater
   * offsets toward the viewer, consistently across images.
   */
  function maskLayersForImage(parentImageId: string) {
    return imageMasks(parentImageId).flatMap((segment) => {
      return segment.representations.labelmap
        ? [
            {
              maskId: segment.id,
              stackIndex:
                segmentRegistry.segmentList.value.length -
                1 -
                segmentRegistry.orderIndexOf(segment.segmentId),
            },
          ]
        : [];
    });
  }

  const updateSegmentationDisplay = (
    segmentationId: string,
    patch: SegmentationDisplayPatch
  ) => Object.assign(getSegmentation(segmentationId), patch);

  /** The mask holds this segment and nothing else, so its voxels go with it. */
  function deleteMask(maskId: string) {
    detachMask(getSegmentationOfMask(maskId), maskId);
  }

  function removeSegmentation(segmentationId: string) {
    edits.beforeEdit();
    delete segmentations[segmentationId];
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
    edits.beforeEdit();
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

  const labelmapDescriptorByMask = createSegmentProjection({
    segmentations,
    segmentRegistry,
  });

  // --- state file --- //

  const { serialize, deserialize } = createSegmentationWire({
    segmentations,
    saveFormat,
    imageCacheStore,
    segmentRegistry,
    labelmapDescriptorByMask,
    createMask,
    detachMask,
    attachMaskBinding,
    decodeSegments,
    ensureSegmentationForImage,
    getSegmentationForImage,
    maskFor,
    splitLabelmapIntoMasks,
  });

  // --- handle deletions --- //

  onImageDeleted((deleted) => {
    deleted.forEach((parentImageId) => {
      artifactNamer.forget(parentImageId);
      const id = getSegmentationForImage(parentImageId)?.id;
      if (id) removeSegmentation(id);
    });
  });

  return {
    segmentations,
    convertingLabelmaps,
    labelmapDescriptorByMask,
    maskFor,
    findEditTarget,
    resolveEditTarget,
    maskExists,
    getSegmentationForImage,
    ensureSegmentationForImage,
    segmentationOfMask,
    getMask,
    findMaskBinding,
    maskVoxels,
    findMaskVoxels,
    createMask,
    ensureLabelmapBinding,
    isLocked,
    updateSegmentationDisplay,
    deleteMask,
    removeSegmentation,
    splitLabelmapIntoMasks,
    decodeSegments,
    convertImageToLabelmap,
    saveFormat,
    voxelClaim,
    imageMasks,
    editableMasks,
    maskLayersForImage,
    serialize,
    deserialize,
  };
});
