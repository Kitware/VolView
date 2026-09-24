import { useSegmentationEditsStore } from '@/src/segmentation/editing/coordinator';
import { defineStore } from 'pinia';
import { markRaw, reactive, ref } from 'vue';
import type { RGBAColor } from '@kitware/vtk.js/types';

import { CATEGORICAL_COLORS } from '@/src/config';
import { NO_NAME } from '@/src/constants';
import { createMaskFileNamer } from '@/src/segmentation/io/maskFileNaming';
import {
  LABELMAP_MAX_VALUE,
  SEGMENT_VALUE,
} from '@/src/segmentation/masks/labelValue';
import { allocateMask } from '@/src/segmentation/masks/storage';
import { createSegmentProjection } from '@/src/segmentation/rendering/projection';
import { createVoxelAccess } from '@/src/segmentation/masks/voxelAccess';
import {
  createSegmentationWire,
  type LabelmapIO,
} from '@/src/segmentation/io/stateFile';

export type { LabelmapIO };
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
  listMasks,
  maskScalars,
  type LabelmapBinding,
  type LabelmapSegment,
  type SegmentMask,
  type Segmentation,
  type SegmentationDisplayPatch,
} from '@/src/segmentation/model';
import {
  emptyExtent,
  isEmptyExtent,
  type Extent3D,
} from '@/src/segmentation/geometry';
import { useSegmentStore } from '@/src/segmentation/segments';
import { declareSegmentReferences } from '@/src/segmentation/segmentReferences';
import { useMessageStore } from '@/src/store/messages';
import {
  cleanUndefined,
  ensureError,
  isRecord,
  removeFromArray,
} from '@/src/utils';
import { cycleColors } from '@/src/utils/color';
import vtkLabelMap from '@/src/vtk/LabelMap';

export type { ImportedSegment } from '@/src/segmentation/io/import';

// The manifest references this store's remove cascade keeps clean (see the
// onImageDeleted registration below), declared for the dev-only save backstop.
declareManifestRefs('segmentations', (manifest) => {
  const segmentations = Array.isArray(manifest.segmentations)
    ? manifest.segmentations
    : [];
  return segmentations.flatMap((raw, index) => {
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
      ...masks.flatMap((mask, maskIndex) =>
        isRecord(mask) && typeof mask.segmentId === 'string'
          ? [
              {
                kind: 'segment' as const,
                id: mask.segmentId,
                where: `${where}.masks[${maskIndex}].segmentId`,
              },
            ]
          : []
      ),
    ];
  });
});

export const useSegmentationStore = defineStore('segmentation', () => {
  const edits = useSegmentationEditsStore();
  const imageCacheStore = useImageCacheStore();
  const segmentRegistry = useSegmentStore().segments;

  const segmentations = reactive<Record<string, Segmentation>>({});
  const convertingLabelmaps = reactive(new Set<DataSelection>());
  // The conversion running for a child image ONTO ONE PARENT, so a second
  // caller for that same pair joins it instead of splitting the same labelmap
  // twice. The parent belongs in the key: the same child going onto another
  // parent is other work, and joining it would hand that caller masks made on
  // an image it never named.
  const conversions = new Map<string, ReturnType<typeof importLabelmapImage>>();
  /**
   * How many bound masks hold each name, so picking a default name probes this
   * rather than walking every mask in the scene. A restore attaches the names
   * the file states, which may repeat, so it counts holders instead of only
   * remembering the name: releasing one mask must not free a name another
   * still holds.
   */
  const maskNameHolders = new Map<string, number>();
  const holdMaskName = (name: string) =>
    maskNameHolders.set(name, (maskNameHolders.get(name) ?? 0) + 1);
  const releaseMaskName = (name: string) => {
    const holders = maskNameHolders.get(name) ?? 0;
    if (holders > 1) maskNameHolders.set(name, holders - 1);
    else maskNameHolders.delete(name);
  };
  const maskFileNamer = createMaskFileNamer(() => maskNameHolders);

  /**
   * Each segmentation's mask id per segment. One image holds at most one mask
   * per segment, so the lookup every create, edit and panel row does is a probe
   * instead of a walk over `order`. Reactive: components resolve their mask
   * inside computeds, so a mask appearing has to reach them.
   */
  const maskIdsBySegment = reactive(new Map<string, Map<string, string>>());

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
    maskIdsBySegment.set(id, new Map());
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
    maskIdsBySegment.get(segmentation.id)?.set(segmentId, id);
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
      name: name ?? maskFileNamer.pick(parentImageId, baseName),
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
    holdMaskName(mask.representations.labelmap.name);
    return mask.representations.labelmap;
  }

  function detachMask(segmentation: Segmentation, maskId: string) {
    edits.beforeEdit();
    const mask = segmentation.masks[maskId];
    const { segmentId } = mask ?? {};
    const boundName = mask?.representations.labelmap?.name;
    removeFromArray(segmentation.order, maskId);
    delete segmentation.masks[maskId];
    const index = maskIdsBySegment.get(segmentation.id);
    if (segmentId && index?.get(segmentId) === maskId) index.delete(segmentId);
    if (boundName !== undefined) releaseMaskName(boundName);
  }

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
    ownSegment = false
  ) {
    const usable = (segmentId: Maybe<string>) =>
      !!segmentId &&
      !!segmentRegistry.getSegment(segmentId) &&
      !maskFor(parentImageId, segmentId);
    const existing = ownSegment
      ? undefined
      : segmentRegistry.findSegmentByName(descriptor.name);
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
      name?: string;
      // A descriptor carrying display of its own mints its segment rather than
      // joining one of the same name, whose display it would otherwise lose.
      ownSegments?: boolean;
    } = {}
  ) {
    // Identity is committed before storage: the segmentation, the registry
    // segment and the mask record all precede the binding that would be the
    // first to notice the parent has gone. Refuse up front, so a conversion
    // whose parent was removed while it ran mints nothing at all.
    if (!imageCacheStore.getVtkImageData(parentImageId))
      throw new Error('No such parent image');
    edits.beforeEdit();
    const segmentation = ensureSegmentationForImage(parentImageId);
    const created: SegmentMask[] = [];

    splitLabelmap(labelmap, descriptors, (descriptor, extent) => {
      const segment = createMask(
        segmentation.id,
        bindDescriptorSegment(parentImageId, descriptor, options.ownSegments)
      );

      const binding = createBindingForImage(
        parentImageId,
        extent,
        options.source,
        options.name
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
    // A second conversion of an image already converting onto the same parent
    // would split it again and mint a suffixed duplicate of every segment, and
    // the first call's cleanup would clear the pending flag while the second
    // still ran. Both callers share the one conversion and see it end when it
    // really ends.
    const pair = `${imageID}|${parentID}`;
    const running = conversions.get(pair);
    if (running) return running;

    const bySourceValue = new Map(
      descriptions.map((descriptor) => [
        descriptor.value,
        cleanUndefined(descriptor),
      ])
    );
    convertingLabelmaps.add(imageID);
    const conversion = importLabelmapImage(imageID, parentID, {
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
    conversions.set(pair, conversion);
    try {
      return await conversion;
    } finally {
      conversions.delete(pair);
      convertingLabelmaps.delete(imageID);
    }
  }

  /**
   * Starts a conversion nobody awaits, and reports its failure. A conversion
   * outlives the load or the click that started it -- the parent image can be
   * removed while the resample runs -- so the rejection needs somewhere to
   * land instead of going unhandled.
   */
  function startLabelmapConversion(
    imageID: DataSelection,
    parentID: DataSelection
  ) {
    return convertImageToLabelmap(imageID, parentID).catch((error) => {
      useMessageStore().addError('Failed to convert image to a labelmap', {
        error: ensureError(error),
      });
    });
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

  const findMaskBinding = (maskId: string) =>
    findMask(maskId)?.representations.labelmap;

  // Editor state, not document state: it is never serialized.
  const allowOverlap = ref(false);

  const { maskVoxels, findMaskVoxels, voxelClaim } = createVoxelAccess({
    imageCacheStore,
    findMask,
    getMask,
    segmentationOfMask,
    ensureLabelmapBinding,
    maskLocked,
    overlapAllowed: () => allowOverlap.value,
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
   * The masks an image draws, in `order`. One actor each; they are translucent,
   * so the renderer blends them rather than stacking them by this order.
   */
  function maskLayersForImage(parentImageId: string) {
    return imageMasks(parentImageId).flatMap((segment) => {
      return segment.representations.labelmap ? [{ maskId: segment.id }] : [];
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
    const segmentation = segmentations[segmentationId];
    if (segmentation)
      listMasks(segmentation).forEach((mask) => {
        const binding = mask.representations.labelmap;
        if (binding) releaseMaskName(binding.name);
      });
    delete segmentations[segmentationId];
    maskIdsBySegment.delete(segmentationId);
  }

  // --- edit targets --- //

  const maskFor = (imageId: Maybe<string>, segmentId: Maybe<string>) => {
    if (!imageId || !segmentId) return undefined;
    const segmentation = getSegmentationForImage(imageId);
    if (!segmentation) return undefined;
    const maskId = maskIdsBySegment.get(segmentation.id)?.get(segmentId);
    return maskId ? segmentation.masks[maskId] : undefined;
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
   * Whether the segment an edit would land in is locked. The refusal cannot
   * wait for a resolved mask: `resolveEditTarget` returns a mask id, so it has
   * to mint the record and its segmentation before anything can be asked about
   * the lock, and a refused edit would leave both behind. This answers from the
   * segment alone, creating nothing, so every edit path can refuse first.
   */
  const editTargetLocked = (preferredSegmentId?: Maybe<string>) =>
    segmentRegistry.appearanceOf(
      liveSegmentId(preferredSegmentId) ?? segmentRegistry.presumedSegmentId()
    ).locked;

  /**
   * Resolves or creates the mask an edit targets. With nothing selected the
   * first edit mints and selects a segment, then takes this image's mask of it.
   * Callers refusing a locked segment ask `editTargetLocked` before this.
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
    createBindingForImage,
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
      maskFileNamer.forget(parentImageId);
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
    editTargetLocked,
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
    startLabelmapConversion,
    saveFormat,
    allowOverlap,
    voxelClaim,
    imageMasks,
    editableMasks,
    maskLayersForImage,
    serialize,
    deserialize,
  };
});
