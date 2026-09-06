import { defineStore } from 'pinia';
import { computed, markRaw, reactive, ref, toRaw } from 'vue';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { RGBAColor, TypedArray } from '@kitware/vtk.js/types';

import { CATEGORICAL_COLORS } from '@/src/config';
import { NO_NAME } from '@/src/constants';
import { createArtifactNamer } from '@/src/store/artifactNaming';
import { nextUnusedLabelValue } from '@/src/store/segmentLabelValue';
import { allocateMask, regrowMask, relabelMask } from '@/src/store/segmentMask';
import {
  createLabelRemapper,
  createParentImageLoader,
  planArtifactRestore,
  prepareRestoreBindings,
  restoredLabelmapImage,
} from '@/src/store/segmentationRestore';
import {
  boundScalars,
  groupByLayer,
  masksClearing,
  masksHolding,
  writeMaskInto,
} from '@/src/store/segmentLayers';
import { onImageDeleted } from '@/src/composables/onImageDeleted';
import { declareManifestRefs } from '@/src/core/manifestRefs';
import { untilLoaded } from '@/src/composables/untilLoaded';
import {
  decodeLabelmapSegments,
  importLabelmapImage,
  splitLabelmap,
  toLabelMap,
} from '@/src/io/labelmapImport';
import { readImage, writeSegmentation } from '@/src/io/readWriteImage';
import { ensureSameSpace } from '@/src/io/resample/resample';
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
import type { Maybe, ProcessingResultSource } from '@/src/types';
import {
  type DataSelection,
  getSelectionStem,
} from '@/src/utils/dataSelection';
import {
  clipExtent,
  DEFAULT_SEGMENTATION_FILL_OPACITY,
  emptyExtent,
  extentContains,
  extentUnion,
  fullExtent,
  isEmptyExtent,
  listSegments,
  maskScalars,
  padExtent,
  type Extent3D,
  type LabelmapBinding,
  type LabelmapSegment,
  type Segment,
  type Segmentation,
  type SegmentationDisplayPatch,
  type SegmentVoxelAccessor,
  type VoxelStorage,
} from '@/src/types/segmentation';
import { toLabelmapSegment } from '@/src/types/segmentType';
import { useSegmentTypeStore } from '@/src/store/segmentTypes';
import { declareSegmentTypeReferences } from '@/src/store/tools/segmentTypeReferences';
import { isRecord, removeFromArray } from '@/src/utils';
import { cycleColors } from '@/src/utils/color';
import { normalize } from '@/src/utils/path';
import vtkLabelMap from '@/src/vtk/LabelMap';

export type ArtifactMetadata = {
  parentImage: string;
  name: string;
  source?: ProcessingResultSource;
};

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

/** Masks are Uint8Array, so a label value has to fit in one byte. */
export const LABELMAP_MAX_VALUE = 255;

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
          return [
            ...(isRecord(segment) && typeof segment.typeId === 'string'
              ? [
                  {
                    kind: 'segmentType' as const,
                    id: segment.typeId,
                    where: `${where}.segments[${segmentIndex}].typeId`,
                  },
                ]
              : []),
            ...(isRecord(binding) && typeof binding.artifactId === 'string'
              ? [
                  {
                    kind: 'segmentationArtifact' as const,
                    id: binding.artifactId,
                    where: `${where}.segments[${segmentIndex}].representations.labelmap.artifactId`,
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
  const segmentTypes = useSegmentTypeStore().types;

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

  // Segment ids are globally unique and one segmentation per image is
  // enforced, so a segment addresses itself; the segmentation is looked up.
  const segmentationOf = (segmentId: string) =>
    Object.values(segmentations).find(
      (segmentation) => segmentId in segmentation.segments
    );

  const findSegment = (segmentId: string) =>
    segmentationOf(segmentId)?.segments[segmentId];

  function getSegmentationOf(segmentId: string) {
    const segmentation = segmentationOf(segmentId);
    if (!segmentation) throw new Error('No such segment');
    return segmentation;
  }

  function getSegment(segmentId: string) {
    const segment = findSegment(segmentId);
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
      segments: {},
      order: [],
      fillOpacity: DEFAULT_SEGMENTATION_FILL_OPACITY,
      outlineOpacity: 1,
      outlineThickness: 2,
    };
    return segmentations[id];
  }

  /** One record per (image, type); the caller has checked there is none. */
  function createSegment(segmentationId: string, typeId: string) {
    const segmentation = getSegmentation(segmentationId);
    const id = useIdStore().nextId();
    segmentation.segments[id] = { id, typeId, representations: {} };
    segmentation.order.push(id);
    return segmentation.segments[id];
  }

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
      listSegments(segmentation).flatMap((segment) =>
        segment.representations.labelmap
          ? [segment.representations.labelmap.labelValue]
          : []
      )
    );
    return nextUnusedLabelValue(used, LABELMAP_MAX_VALUE, preferred);
  }

  /**
   * The type a file's descriptor binds to: the one already carrying that exact
   * name, or a new one minted from the file. The registry's own color wins on
   * a match. A name already taken on this image mints a suffixed type instead,
   * since one image holds at most one mask per type.
   */
  /** A record is editable when the type it delineates is unlocked. */
  const isLocked = (segmentId: string) =>
    segmentTypes.appearanceOf(findSegment(segmentId)?.typeId).locked;

  function bindDescriptorType(
    parentImageId: string,
    descriptor: LabelmapSegment,
    preferredTypeId?: Maybe<string>
  ) {
    const usable = (typeId: Maybe<string>) =>
      !!typeId &&
      !!segmentTypes.getType(typeId) &&
      !findRecord(parentImageId, typeId);
    if (usable(preferredTypeId)) return preferredTypeId!;
    const existing = segmentTypes.findTypeByName(descriptor.name);
    if (existing && usable(existing.id)) return existing.id;
    // A minted type takes the file's whole description; a matched one keeps
    // what the registry already says, its visibility and lock included.
    return segmentTypes.mintType({
      name: segmentTypes.uniqueName(descriptor.name),
      color: [...descriptor.color] as RGBAColor,
      visible: descriptor.visible,
      locked: descriptor.locked ?? false,
      ...(descriptor.fillOpacity === undefined
        ? {}
        : { fillOpacity: descriptor.fillOpacity }),
      ...(descriptor.outlineOpacity === undefined
        ? {}
        : { outlineOpacity: descriptor.outlineOpacity }),
    });
  }

  /**
   * Mints one record per descriptor and fills its bounded mask. The records
   * share one segmentation, so label values are assigned against what is
   * already in it and a taken value gets remapped.
   */
  function splitLabelmapIntoSegments(
    parentImageId: string,
    labelmap: vtkLabelMap,
    descriptors: LabelmapSegment[],
    options: {
      source?: ProcessingResultSource;
      artifactName?: string;
      // The type a descriptor already belongs to, for a split that replaces
      // records rather than importing a file.
      typeIdFor?: (descriptor: LabelmapSegment) => Maybe<string>;
    } = {}
  ) {
    const segmentation = ensureSegmentationForImage(parentImageId);
    const created: Segment[] = [];

    splitLabelmap(labelmap, descriptors, (descriptor, extent) => {
      // Claimed before the segment exists: exhausting the values throws, and a
      // segment minted first would be left in the list with no mask.
      const labelValue = nextLabelValue(segmentation, descriptor.value);
      const segment = createSegment(
        segmentation.id,
        bindDescriptorType(
          parentImageId,
          descriptor,
          options.typeIdFor?.(descriptor)
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

  // Deliberately separate from createSegment's cursor: a descriptor-less
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
        splitLabelmapIntoSegments(parentID, labelmap, descriptors, {
          source,
        }).map((segment) => segment.id),
    });
  }

  const saveFormat = ref('vti');

  /** The single voxel-allocation point: no other operation creates storage. */
  function ensureLabelmapBinding(segmentId: string) {
    const segmentation = getSegmentationOf(segmentId);
    const segment = segmentation.segments[segmentId];
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
  const findSegmentBinding = (segmentId: string) =>
    findSegment(segmentId)?.representations.labelmap;

  /**
   * A copy of a segment's binding, or undefined when it has none. No live
   * buffer travels with it: the copied extent would go stale beside one.
   */
  function resolveLabelmapBinding(segmentId: string) {
    const binding = getSegment(segmentId).representations.labelmap;
    if (!binding) return undefined;
    return { ...toRaw(binding) };
  }

  function requireArtifactContext(artifactId: string) {
    const mask = artifactIndex[artifactId];
    const meta = artifactMeta[artifactId];
    if (!mask || !meta) throw new Error('No such artifact');
    const parent = imageCacheStore.getVtkImageData(meta.parentImage);
    if (!parent) throw new Error('No such parent image');
    return { mask, parent };
  }

  function requireArtifactBinding(artifactId: string) {
    const segment = segmentsForArtifact(artifactId)[0];
    const binding = segment?.representations.labelmap;
    if (!binding) throw new Error('No segment bound to this artifact');
    return binding;
  }

  /**
   * Grows one mask, in place, to cover `extent` in parent index space, with
   * `padding` voxels of room beyond it when it has to grow at all.
   */
  function ensureArtifactContains(
    artifactId: string,
    extent: Extent3D,
    padding = 0
  ) {
    if (isEmptyExtent(extent)) return false;

    const { mask, parent } = requireArtifactContext(artifactId);
    // Refused before anything is touched, so a rejected growth leaves the mask
    // exactly as it was.
    const parentExtent = fullExtent(parent.getDimensions());
    if (!extentContains(parentExtent, extent))
      throw new Error('Extent leaves the parent image');

    const binding = requireArtifactBinding(artifactId);
    const current = binding.extent;
    if (!isEmptyExtent(current) && extentContains(current, extent))
      return false;

    const requested = clipExtent(padExtent(extent, padding), parentExtent);
    const grown = isEmptyExtent(current)
      ? requested
      : extentUnion(current, requested);
    regrowMask(mask, parent, current, grown);
    binding.extent = grown;
    return true;
  }

  /**
   * The voxel half of the accessor seam, over whichever mask `findArtifactId`
   * resolves. Resolution is deferred to every call so a stale accessor sees
   * deletion or growth done through another one. `onMissing` names why storage
   * is unreachable, so `exists()` can answer without throwing.
   */
  function voxelStorage(
    findArtifactId: () => Maybe<string>,
    onMissing: () => never
  ): VoxelStorage {
    const findImage = () => {
      const artifactId = findArtifactId();
      return artifactId ? artifactIndex[artifactId] : undefined;
    };
    const requireImage = () => findImage() ?? onMissing();
    const requireScalars = () => maskScalars(requireImage());

    return {
      exists: () => !!findImage(),
      image: requireImage,
      scalars: requireScalars,
      snapshot: () => requireScalars().slice(),
      apply: (scalars: TypedArray | number[]) => {
        const image = requireImage();
        const data = maskScalars(image);
        if (scalars.length !== data.length) {
          throw new Error('Scalar length does not match storage');
        }
        data.set(scalars);
        image.modified();
      },
      ensureContains: (extent: Extent3D, padding = 0) => {
        requireImage();
        return ensureArtifactContains(findArtifactId()!, extent, padding);
      },
    };
  }

  /**
   * The accessor every labelmap consumer that holds a segment routes through.
   * The binding is re-resolved on every call rather than captured.
   */
  function segmentVoxels(segmentId: string): SegmentVoxelAccessor {
    // Validates eagerly: an accessor for a nonexistent segment is refused up
    // front, not just on first use.
    getSegment(segmentId);

    const binding = () => getSegment(segmentId).representations.labelmap;

    // Deliberately tolerant where binding() is not: the segment itself can be
    // deleted out from under an accessor, and that is an absent storage, not a
    // lookup error.
    const findArtifactId = () =>
      findSegment(segmentId)?.representations.labelmap?.artifactId;

    const onMissing = (): never => {
      if (!binding()) throw new Error('No storage: call materialize() first');
      throw new Error('No such artifact');
    };

    return {
      binding,
      materialize: () => ensureLabelmapBinding(segmentId),
      ...voxelStorage(findArtifactId, onMissing),
    };
  }

  /**
   * The accessor for consumers that hold an artifact and no segment. Stays
   * constructible for an artifact that is gone: the renderer and the paint
   * widget are computeds keyed on an id that can vanish a tick before they do.
   */
  function artifactVoxels(artifactId: string) {
    return voxelStorage(
      () => (artifactIndex[artifactId] ? artifactId : undefined),
      () => {
        throw new Error('No such artifact');
      }
    );
  }

  /** A bound segment's buffer, absent when it has none or holds nothing. */
  const boundedMask = (binding?: LabelmapBinding) =>
    binding && boundScalars(artifactIndex[binding.artifactId], binding.extent);

  /**
   * The masks of an image's other segments that `gesture` may take a voxel
   * from, resolved once per run because the caller below runs per voxel. A
   * locked segment is not editable, so an aimed gesture is not offered its mask
   * at all.
   */
  function siblingMasks(segmentId: string, gesture: VoxelGesture) {
    const segmentation = segmentationOf(segmentId);
    if (!segmentation) return [];
    return listSegments(segmentation).flatMap((segment) => {
      if (segment.id === segmentId) return [];
      if (gesture === 'aimed' && isLocked(segment.id)) return [];
      const bounded = boundedMask(segment.representations.labelmap);
      return bounded ? [bounded] : [];
    });
  }

  /**
   * Whether the voxel at PARENT indices i, j, k is this segment's to write,
   * taking it from the neighbours that have to yield it. Absent when no other
   * segment reaches `within`, the box the caller is about to walk: every voxel
   * in it is then uncontested and the question need not be asked per voxel.
   *
   * `gesture` is the whole of the policy, so see {@link VoxelGesture}.
   */
  function voxelClaim(
    segmentId: string,
    gesture: VoxelGesture,
    within: Extent3D
  ) {
    const masks = siblingMasks(segmentId, gesture);
    if (gesture === 'aimed') return masksClearing(masks, within);
    const held = masksHolding(masks, within);
    return held && ((i: number, j: number, k: number) => !held(i, j, k));
  }

  /** The image's segments in `order`, or none when it has no segmentation. */
  function imageSegments(parentImageId: string) {
    const segmentation = getSegmentationForImage(parentImageId);
    return segmentation ? listSegments(segmentation) : [];
  }

  /**
   * The given segments as one parent-shaped labelmap, built on demand and never
   * stored: what leaves VolView means the whole segmentation, not one segment's
   * bounded mask. Later in the registry wins where two segments overlap, which
   * is the order their actors stack in, so the flattened file resolves an
   * overlap the way the screen did. `members` defaults to the image's segments;
   * an export passes one group so no overlap is flattened away.
   */
  function compositeLabelmap(parentImageId: string, members?: Segment[]) {
    const parent = imageCacheStore.getVtkImageData(parentImageId);
    if (!parent) throw new Error('No such parent image');

    const dimensions = parent.getDimensions();
    const labelmap = allocateMask(parent, fullExtent(dimensions));
    const values = maskScalars(labelmap);

    const included = [...(members ?? imageSegments(parentImageId))].sort(
      (first, second) =>
        segmentTypes.orderIndexOf(first.typeId) -
        segmentTypes.orderIndexOf(second.typeId)
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
        toLabelmapSegment(segmentTypes.getType(segment.typeId), labelValue)
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
    const groups = groupByLayer(imageSegments(parentImageId), (segment) =>
      boundedMask(segment.representations.labelmap)
    );
    return groups.length ? groups : [[]];
  }

  /**
   * The segments of an image a process may edit: unlocked, since a locked one
   * is not editable, and holding voxels, since an empty mask has no content to
   * process.
   */
  function editableSegments(parentImageId: string) {
    return imageSegments(parentImageId).flatMap((segment) => {
      const binding = segment.representations.labelmap;
      if (isLocked(segment.id) || !binding || isEmptyExtent(binding.extent))
        return [];
      return [{ segmentId: segment.id, labelValue: binding.labelValue }];
    });
  }

  /**
   * The segments of an image that have a mask, with their place in the type
   * registry: that order is what the renderer offsets by, so two images show
   * one type at the same depth.
   */
  function segmentLayersForImage(parentImageId: string) {
    return imageSegments(parentImageId).flatMap((segment) => {
      const { artifactId } = segment.representations.labelmap ?? {};
      return artifactId
        ? [
            {
              segmentId: segment.id,
              artifactId,
              stackIndex: segmentTypes.orderIndexOf(segment.typeId),
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

  function deleteSegment(segmentId: string) {
    const segmentation = getSegmentationOf(segmentId);
    const binding = segmentation.segments[segmentId].representations.labelmap;

    detachSegment(segmentation, segmentId);

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

  /** This image's record for a type, absent when the type has no mask here. */
  const findRecord = (imageId: Maybe<string>, typeId: Maybe<string>) => {
    if (!imageId || !typeId) return undefined;
    const segmentation = getSegmentationForImage(imageId);
    return segmentation
      ? listSegments(segmentation).find((segment) => segment.typeId === typeId)
      : undefined;
  };

  /** The record for (image, type). Creates identity only, never voxels. */
  function ensureRecord(imageId: string, typeId: string) {
    const existing = findRecord(imageId, typeId);
    if (existing) return existing;
    const segmentation = ensureSegmentationForImage(imageId);
    return createSegment(segmentation.id, typeId);
  }

  /** Whether a segment id is live anywhere, used to tell stale ids from foreign ones. */
  const segmentExists = (segmentId: string) => !!findSegment(segmentId);

  // A type the caller named that no longer exists is a stale reference, not a
  // target: the edit falls through to the selected type.
  const liveTypeId = (typeId: Maybe<string>) =>
    typeId && segmentTypes.getType(typeId) ? typeId : undefined;

  /**
   * The record an edit would land in, if it already exists. Creates nothing, so
   * an operation with nothing to allocate for, erasing above all, can refuse
   * before a record is created.
   */
  function findEditTarget(imageId: string, preferredTypeId?: Maybe<string>) {
    const typeId =
      liveTypeId(preferredTypeId) ?? segmentTypes.selectedTypeId.value;
    return findRecord(imageId, typeId)?.id;
  }

  /**
   * Resolves or creates the record an edit targets. With nothing selected the
   * first edit mints and selects a type, then takes this image's record for it.
   */
  function resolveEditTarget(imageId: string, preferredTypeId?: Maybe<string>) {
    const typeId =
      liveTypeId(preferredTypeId) ?? segmentTypes.ensureSelectedType();
    return ensureRecord(imageId, typeId).id;
  }

  /** Every image's record for a type, for the referenced-type deletion. */
  const recordsOfType = (typeId: string) =>
    Object.values(segmentations).flatMap((segmentation) =>
      listSegments(segmentation).filter((segment) => segment.typeId === typeId)
    );

  declareSegmentTypeReferences('labelmaps', {
    has: (typeId) => recordsOfType(typeId).length > 0,
    remove: (typeId) =>
      recordsOfType(typeId).forEach((segment) => deleteSegment(segment.id)),
  });

  // --- render sync --- //

  // The labelmap renderer colors by voxel value, so it reads the value-keyed
  // projection of the segments bound to each artifact.
  const labelmapSegmentsByArtifact = computed(() => {
    const byArtifact: Record<string, LabelmapSegment[]> = {};
    Object.keys(artifactMeta).forEach((artifactId) => {
      byArtifact[artifactId] = [];
    });
    Object.values(segmentations).forEach((segmentation) => {
      listSegments(segmentation).forEach((segment) => {
        const binding = segment.representations.labelmap;
        if (!binding || !byArtifact[binding.artifactId]) return;
        byArtifact[binding.artifactId].push(
          toLabelmapSegment(
            segmentTypes.getType(segment.typeId),
            binding.labelValue
          )
        );
      });
    });
    return byArtifact;
  });

  // --- state file --- //

  /**
   * A mask that covers nothing holds no voxels, and an image codec has nothing
   * to write; the binding's empty extent is what restores it, so one background
   * voxel stands in for the bytes.
   */
  function writableMask(artifactId: string) {
    const mask = artifactIndex[artifactId];
    if (mask.getDimensions().every((size) => size > 0)) return mask;
    const parent = imageCacheStore.getVtkImageData(
      artifactMeta[artifactId].parentImage
    );
    return parent ? allocateMask(parent, [0, 0, 0, 0, 0, 0]) : mask;
  }

  async function serialize(
    state: StateFile,
    io: SegmentationArtifactIO = defaultArtifactIO
  ) {
    const { zip, manifest } = state;
    const format = saveFormat.value;
    const usedArchivePaths = new Set<string>();

    const entries = Object.keys(artifactMeta).map((artifactId) => ({
      artifactId,
      meta: artifactMeta[artifactId],
      path: makeSegmentGroupArchivePath(
        artifactMeta[artifactId].name,
        format,
        usedArchivePaths
      ),
    }));

    manifest.segmentationArtifacts = entries.map(
      ({ artifactId, meta, path }) => ({
        id: artifactId,
        parentImage: meta.parentImage,
        name: meta.name,
        path,
        ...(meta.source ? { source: meta.source } : {}),
      })
    );

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
            typeId: segment.typeId,
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
      })
    );

    await Promise.all(
      entries.map(async ({ artifactId, path }) => {
        zip.file(
          path,
          await io.write(
            format,
            writableMask(artifactId),
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
    // Ids the type registry minted for the incoming types, keyed by wire id.
    typeIdMap: Record<string, string> = {},
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

    const { boundArtifactIds, needsDecode, needsSplit } =
      planArtifactRestore(manifest);
    const loadedParentImage = createParentImageLoader(
      dataIDMap,
      untilLoaded,
      (id) => imageCacheStore.getVtkImageData(id) ?? undefined
    );

    // Skip BEFORE awaiting anything an artifact whose parent image is
    // unresolved, or a path-less one whose datasource never materialized;
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
            const labelmap = toLabelMap(
              await restoredLabelmapImage(artifact, image, {
                needsSplit,
                loadedParentImage,
                ensureSameSpace,
              })
            );
            // A group that carried no descriptors is enumerated here, through
            // the same decode live import uses, while its source image is
            // still loaded: the temp artifact dataset is dropped below.
            const decoded = needsDecode(artifact)
              ? ((await decodeSegments(storeId, labelmap, {
                  headerMetadata,
                })) as LabelmapSegment[])
              : undefined;
            return { artifact, labelmap, decoded };
          } catch {
            // A parse/read failure skips just this artifact and never rejects the
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

    // A migrated group holds every segment in one buffer, so its bindings are
    // placeholders until it is split below; nothing reshapes its mask.
    const artifactsToSplit = new Set(
      loaded.flatMap((result) =>
        result && needsSplit(result.artifact)
          ? [artifactIdMap[result.artifact.id]]
          : []
      )
    );

    // Validate every reference before changing shared artifact geometry. One
    // malformed binding must not reshape or erase storage a later binding uses.
    const prepared = prepareRestoreBindings({
      manifest,
      dataIDMap,
      artifactIdMap,
      artifactsToSplit,
      artifactParentById: Object.fromEntries(
        Object.entries(artifactMeta).map(([id, meta]) => [id, meta.parentImage])
      ),
      artifactImages: artifactIndex,
      getParentImage: (id) => imageCacheStore.getVtkImageData(id) ?? undefined,
    });
    skipped.push(...prepared.skipped);
    const { acceptedBindings } = prepared;

    const { relabels, remap } = createLabelRemapper(
      artifactsToSplit,
      nextLabelValue,
      LABELMAP_MAX_VALUE
    );

    (manifest.segmentations ?? []).forEach((wire) => {
      const parentImageId = dataIDMap[wire.parentImage];
      if (parentImageId === undefined) return;

      // An import into an image that already has masks adds to them: the
      // display this scene is set to is the user's, not the incoming file's.
      const existing = getSegmentationForImage(parentImageId);
      const segmentation =
        existing ?? ensureSegmentationForImage(parentImageId);
      if (!existing) {
        segmentation.name = wire.name;
        segmentation.fillOpacity = wire.fillOpacity;
        segmentation.outlineOpacity = wire.outlineOpacity;
        segmentation.outlineThickness = wire.outlineThickness;
      }

      const wireById = new Map(
        wire.segments.map((segment) => [segment.id, segment])
      );
      wire.order.forEach((wireSegmentId) => {
        const wireSegment = wireById.get(wireSegmentId);
        if (!wireSegment) return;

        // A record whose type did not restore has no identity to show, and a
        // second record for a type already on this image cannot exist.
        const typeId = typeIdMap[wireSegment.typeId];
        if (!typeId || findRecord(parentImageId, typeId)) return;

        const segment = createSegment(segmentation.id, typeId);

        const binding = wireSegment.representations.labelmap;
        const accepted = acceptedBindings.get(wireSegment);
        if (binding && accepted) {
          const labelValue = remap(
            segmentation,
            accepted.artifactId,
            binding.labelValue,
            (reason) =>
              skipped.push({
                name: segmentTypes.appearanceOf(typeId).name,
                reason,
              })
          );
          if (labelValue !== undefined) {
            segment.representations.labelmap = {
              artifactId: accepted.artifactId,
              labelValue,
              extent: accepted.extent,
            };
          }
        }
        segmentIdMap[wireSegmentId] = segment.id;
      });
    });

    relabels.forEach((mapping, artifactId) =>
      relabelMask(artifactIndex[artifactId], mapping)
    );

    // Split after the wire segmentations so a legacy group's segments follow
    // the ones the manifest named, not precede them. A migrated group holds
    // every segment in one buffer: `decoded` names them when the group carried
    // no descriptors, the restored bindings when it did.
    loaded.forEach((result) => {
      if (!result) return;
      const { artifact } = result;
      const artifactId = artifactIdMap[artifact.id];
      if (!artifactsToSplit.has(artifactId)) return;

      // `decoded` names the segments when the group carried no descriptors;
      // otherwise the bindings the manifest just restored do.
      const migrated = segmentsForArtifact(artifactId);
      // A descriptor built from a record carries that record's type, so the
      // split lands in the type the manifest named rather than matching by
      // name against a type another record already holds.
      const carriedTypeIds = new Map<LabelmapSegment, string>();
      const descriptors = (
        result.decoded ??
        migrated.map((segment) => {
          const descriptor = toLabelmapSegment(
            segmentTypes.getType(segment.typeId),
            segment.representations.labelmap!.labelValue
          );
          carriedTypeIds.set(descriptor, segment.typeId);
          return descriptor;
        })
      ).map((descriptor) => {
        const withDisplay = {
          ...descriptor,
          ...(artifact.pendingFillOpacity === undefined
            ? {}
            : { fillOpacity: artifact.pendingFillOpacity }),
          ...(artifact.pendingOutlineOpacity === undefined
            ? {}
            : { outlineOpacity: artifact.pendingOutlineOpacity }),
          ...(artifact.pendingVisibility === undefined
            ? {}
            : {
                visible: descriptor.visible && artifact.pendingVisibility,
              }),
        };
        const carried = carriedTypeIds.get(descriptor);
        if (carried) carriedTypeIds.set(withDisplay, carried);
        return withDisplay;
      });

      // The source goes first, so the split segments can take the label values
      // the migrated ones were holding.
      const parentImageId = dataIDMap[artifact.parentImage];
      const segmentation = ensureSegmentationForImage(parentImageId);
      const orderBefore = [...segmentation.order];
      const labelmap = artifactIndex[artifactId];
      const migratedIds = migrated.map((segment) => segment.id);
      const wireIdByStoreId = new Map(
        Object.entries(segmentIdMap).map(([wireId, storeId]) => [
          storeId,
          wireId,
        ])
      );
      const selectedBefore = segmentTypes.selectedTypeId.value;
      const migratedTypeIds = new Map(
        migrated.map((segment) => [segment.id, segment.typeId])
      );
      removeArtifact(artifactId);

      const created = splitLabelmapIntoSegments(
        parentImageId,
        labelmap,
        descriptors,
        {
          source: artifact.source,
          artifactName: artifact.name,
          typeIdFor: (descriptor) => carriedTypeIds.get(descriptor),
        }
      );

      // Every reference to a segment that went with the source artifact moves
      // onto the split one that replaced it, its place in the order included.
      const replacementOf = new Map<string, string>();
      migratedIds.forEach((segmentId, index) => {
        const replacement = created[index];
        if (!replacement) return;
        replacementOf.set(segmentId, replacement.id);
        const wireId = wireIdByStoreId.get(segmentId);
        if (wireId) segmentIdMap[wireId] = replacement.id;
        // The split mints its own types, so a selection on the source type
        // follows onto the type its replacement landed in.
        if (selectedBefore === migratedTypeIds.get(segmentId))
          segmentTypes.selectType(replacement.typeId);
      });

      const placed = orderBefore.flatMap((segmentId) => {
        const replacement = replacementOf.get(segmentId);
        if (replacement) return [replacement];
        return segmentation.segments[segmentId] ? [segmentId] : [];
      });
      segmentation.order = [
        ...placed,
        ...created
          .map((segment) => segment.id)
          .filter((segmentId) => !placed.includes(segmentId)),
      ];

      // A migrated legacy group carried its active paint value here, because
      // its segments did not exist when activeSegment was applied above. It is
      // a SOURCE value, and the split segment holding it keeps that value only
      // when nothing else on this parent image already had it, so the
      // descriptor it came from is what identifies the segment.
      const { pendingActiveValue } = artifact;
      if (pendingActiveValue === undefined) return;
      const activeIndex = descriptors.findIndex(
        (descriptor) => descriptor.value === pendingActiveValue
      );
      const active = activeIndex === -1 ? undefined : created[activeIndex];
      if (active) segmentTypes.selectType(active.typeId);
    });

    Object.entries(artifactIdMap).forEach(([wireArtifactId, artifactId]) => {
      if (
        artifactMeta[artifactId] &&
        segmentsForArtifact(artifactId).length === 0
      ) {
        // A bound artifact that lost every segment was already reported per
        // binding; only one nothing referenced gets a notice here.
        if (!boundArtifactIds.has(wireArtifactId)) {
          skipped.push({
            name: artifactMeta[artifactId].name,
            reason: 'labelmap holds no segments',
          });
        }
        removeArtifact(artifactId);
        delete artifactIdMap[wireArtifactId];
      }
    });

    return { artifactIdMap, segmentIdMap, skipped };
  }

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
    findRecord,
    findEditTarget,
    resolveEditTarget,
    segmentExists,
    getSegmentationForImage,
    ensureSegmentationForImage,
    getSegment,
    resolveLabelmapBinding,
    findSegmentBinding,
    segmentVoxels,
    artifactVoxels,
    createSegment,
    ensureLabelmapBinding,
    isLocked,
    updateSegmentationDisplay,
    reorderSegments,
    deleteSegment,
    removeSegmentation,
    getSegmentationForArtifact,
    segmentsForArtifact,
    registerArtifact,
    createArtifactForImage,
    updateArtifactMeta,
    splitLabelmapIntoSegments,
    decodeSegments,
    convertImageToLabelmap,
    saveFormat,
    voxelClaim,
    compositeLabelmap,
    layeredSegments,
    imageSegments,
    editableSegments,
    segmentLayersForImage,
    removeArtifact,
    serialize,
    deserialize,
  };
});
