import { defineStore } from 'pinia';
import { markRaw, reactive, readonly, ref, shallowReactive } from 'vue';
import type { RGBAColor } from '@kitware/vtk.js/types';

import { CATEGORICAL_COLORS } from '@/src/config';
import { NO_NAME } from '@/src/constants';
import { createMaskFileNamer } from '@/src/segmentation/io/maskFileNaming';
import { allocateMask } from '@/src/segmentation/masks/storage';
import { createSegmentProjection } from '@/src/segmentation/rendering/projection';
import { createVoxelAccess } from '@/src/segmentation/masks/voxelAccess';
import { useSegmentationEditsStore } from '@/src/segmentation/editing/coordinator';
import {
  createSegmentationWire,
  type LabelmapIO,
} from '@/src/segmentation/io/stateFile';
import { onImageDeleted } from '@/src/composables/onImageDeleted';
import { declareManifestRefs } from '@/src/core/manifestRefs';
import {
  decodeLabelmapSegments,
  importLabelmapImage,
  splitLabelmap,
  type DecodeOptions,
} from '@/src/segmentation/io/import';
import { useIdStore } from '@/src/store/id';
import { useImageCacheStore } from '@/src/store/image-cache';
import type { Maybe, ProcessingResultSource } from '@/src/types';
import {
  type DataSelection,
  getSelectionStem,
} from '@/src/utils/dataSelection';
import {
  DEFAULT_SEGMENTATION_DISPLAY,
  listMasks,
  makeDefaultSegmentName,
  maskHasContent,
  maskScalars,
  type LabelmapBinding,
  type LabelmapSegment,
  type SegmentMask,
  type Segmentation,
  type SegmentationDisplayPatch,
} from '@/src/segmentation/model';
import {
  emptyExtent,
  hasMarkedVoxel,
  type Extent3D,
} from '@/src/segmentation/geometry';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useMessageStore } from '@/src/store/messages';
import {
  cleanUndefined,
  cycle,
  ensureError,
  isRecord,
  removeFromArray,
} from '@/src/utils';
import vtkLabelMap from '@/src/vtk/LabelMap';

export type { LabelmapIO };

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

/**
 * What a caller says about one source label value. Only `value` identifies the
 * bin; everything else overrides what the labelmap's own metadata decoded.
 */
type SourceDescription = Pick<LabelmapSegment, 'value'> &
  Partial<Omit<LabelmapSegment, 'value'>>;

export const useSegmentationStore = defineStore('segmentation', () => {
  const edits = useSegmentationEditsStore();
  const imageCacheStore = useImageCacheStore();
  const segmentRegistry = useSegmentStore().segments;

  const segmentations = reactive<Record<string, Segmentation>>({});
  // The conversions running for each child image, by parent, so a second
  // caller for the same pair joins it instead of splitting the same labelmap
  // twice. The parent belongs in the key: the same child going onto another
  // parent is other work, and joining it would hand that caller masks made on
  // an image it never named. Shallow: readers only ask whether a child has one.
  const conversions = shallowReactive(
    new Map<
      DataSelection,
      Map<DataSelection, ReturnType<typeof importLabelmapImage>>
    >()
  );
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
  const maskFileNamer = createMaskFileNamer((name) =>
    maskNameHolders.has(name)
  );

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

  // Mask ids are globally unique and one segmentation per image is enforced,
  // so a mask id alone finds its segmentation.
  const segmentationOfMask = (maskId: string) =>
    Object.values(segmentations).find(
      (segmentation) => maskId in segmentation.masks
    );

  const findMask = (maskId: string) =>
    segmentationOfMask(maskId)?.masks[maskId];

  function getSegmentationOfMask(maskId: string) {
    const segmentation = segmentationOfMask(maskId);
    if (!segmentation) throw new Error('No such mask');
    return segmentation;
  }

  function getMask(maskId: string) {
    const mask = findMask(maskId);
    if (!mask) throw new Error('No such mask');
    return mask;
  }

  /** The image whose grid a mask's voxels sit on. */
  function parentImageOfMask(maskId: string) {
    const { parentImageId } = getSegmentationOfMask(maskId);
    const image = imageCacheStore.getVtkImageData(parentImageId);
    if (!image) throw new Error('No such parent image');
    return image;
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
      ...DEFAULT_SEGMENTATION_DISPLAY,
    };
    maskIdsBySegment.set(id, new Map());
    return segmentations[id];
  }

  /** Creates one mask per (image, segment), refusing duplicate or dangling identity. */
  function createMask(segmentationId: string, segmentId: string) {
    const segmentation = getSegmentation(segmentationId);
    if (!segmentRegistry.getSegment(segmentId))
      throw new Error('No such segment');
    if (maskFor(segmentation.parentImageId, segmentId))
      throw new Error('Segment already has a mask on this image');
    const id = useIdStore().nextId();
    segmentation.masks[id] = { id, segmentId, representations: {} };
    segmentation.order.push(id);
    maskIdsBySegment.get(segmentation.id)?.set(segmentId, id);
    return segmentation.masks[id];
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

  /**
   * Attaches fresh voxels on the parent's grid, covering `extent`. `name` is
   * the name a manifest carried: it reaches the saved zip's entry path, so a
   * restore that generated one instead would rename the file on every round
   * trip. Duplicates are fine, serialize resolves the archive path against the
   * ones it has already used.
   */
  function allocateMaskBinding(
    maskId: string,
    extent: Extent3D = emptyExtent(),
    source?: ProcessingResultSource,
    name?: string
  ) {
    const { parentImageId } = getSegmentationOfMask(maskId);
    const imageData = parentImageOfMask(maskId);

    const baseName =
      imageCacheStore.getImageMetadata(parentImageId)?.name ?? NO_NAME;
    return attachMaskBinding(maskId, {
      image: allocateMask(imageData, extent),
      extent,
      name: name ?? maskFileNamer.pick(parentImageId, baseName),
      ...(source ? { source } : {}),
    });
  }

  // `locked` is required, so a per-stroke read skips resolving the appearance.
  const segmentLocked = (segmentId: Maybe<string>) =>
    segmentRegistry.getSegment(segmentId)?.locked ?? false;

  const maskLocked = (mask: SegmentMask) => segmentLocked(mask.segmentId);

  const isLocked = (maskId: string) =>
    segmentLocked(findMask(maskId)?.segmentId);

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
    const existing = ownSegment
      ? undefined
      : segmentRegistry.findSegmentByName(descriptor.name);
    if (existing && !maskFor(parentImageId, existing.id)) return existing.id;
    // A minted segment takes the file's whole description; a matched one keeps
    // what the registry already says, its visibility and lock included.
    return segmentRegistry.mintSegment({
      name: segmentRegistry.uniqueName(descriptor.name),
      color: [...descriptor.color] as RGBAColor,
      visible: descriptor.visible,
      locked: descriptor.locked,
      fillOpacity: descriptor.fillOpacity,
      outlineOpacity: descriptor.outlineOpacity,
    });
  }

  /**
   * Mints one mask per descriptor, each cropped to its value's voxels and
   * holding SEGMENT_VALUE.
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
      const mask = createMask(
        segmentation.id,
        bindDescriptorSegment(parentImageId, descriptor, options.ownSegments)
      );

      const binding = allocateMaskBinding(
        mask.id,
        extent,
        options.source,
        options.name
      );
      created.push(mask);
      return maskScalars(binding.image);
    });

    return created;
  }

  // Separate from the registry's mint cursor: a descriptor-less labelmap
  // decodes to the same catalog however many segments were minted by hand.
  const nextCategoricalColor = cycle(CATEGORICAL_COLORS);
  const getNextDecodeColor = () =>
    [...nextCategoricalColor(), 255] as RGBAColor;

  function decodeSegments(
    imageId: DataSelection | undefined,
    image: vtkLabelMap,
    options: Pick<
      DecodeOptions,
      'component' | 'headerMetadata' | 'declared' | 'baseName'
    > = {}
  ) {
    return decodeLabelmapSegments(imageId, image, {
      ...options,
      // A descriptor-less labelmap reads as the file it arrived in, not as
      // 'Segment N'; the cold restore decodes through here too, so the two
      // paths keep naming one labelmap alike. A caller reading bytes no loaded
      // image holds says what they arrived as, since there is no selection
      // here to take a name from.
      baseName:
        options.baseName ??
        (imageId === undefined ? undefined : getSelectionStem(imageId)),
      nextColor: getNextDecodeColor,
    });
  }

  // A declared value no component carried becomes an empty segment, so a
  // result that found nothing reads differently from one that never looked.
  function withDeclaredEmpties(
    decoded: LabelmapSegment[],
    bySourceValue: Map<number, Partial<SourceDescription>>,
    covered: Set<number>
  ) {
    const empties = [...bySourceValue]
      .filter(([value]) => value !== 0 && !covered.has(value))
      .map(([value, description]) => ({
        ...description,
        value,
        name: description.name ?? makeDefaultSegmentName(value),
        color: [...(description.color ?? getNextDecodeColor())] as RGBAColor,
        visible: description.visible ?? true,
      }));
    return [...decoded, ...empties];
  }

  async function convertImageToLabelmap(
    imageID: DataSelection,
    parentID: DataSelection,
    source?: ProcessingResultSource,
    descriptions: SourceDescription[] = []
  ) {
    // A second conversion of an image already converting onto the same parent
    // would split it again and mint a suffixed duplicate of every segment, and
    // the first call's cleanup would clear the pending flag while the second
    // still ran. Both callers share the one conversion and see it end when it
    // really ends; the joining caller's source and descriptions go unused.
    const running = conversions.get(imageID)?.get(parentID);
    if (running) return running;

    const bySourceValue = new Map(
      descriptions.map((descriptor) => [
        descriptor.value,
        cleanUndefined(descriptor),
      ])
    );
    // Every source value any component of this image carries voxels for. A
    // declaration is empty only when none of them did.
    const coveredValues = new Set<number>();
    const conversion = importLabelmapImage(imageID, parentID, {
      // The empties join the descriptor list here, not at the split: the
      // import pairs the masks the split returns with these descriptors by
      // position, so the two lists have to be the same one. They wait for the
      // last component, once every component has said which values it carries.
      decode: async (labelmap, component, componentCount) => {
        const last = component === componentCount - 1;
        const decoded = (await decodeSegments(imageID, labelmap, {
          component,
          // The file header's own declarations wait for the last component the
          // same way, through the same covered values.
          declared: { covered: coveredValues, last },
        })) as LabelmapSegment[];
        decoded.forEach((descriptor) => coveredValues.add(descriptor.value));
        if (!last) return decoded;
        return withDeclaredEmpties(decoded, bySourceValue, coveredValues);
      },
      split: (labelmap, descriptors) => {
        const created = splitLabelmapIntoMasks(
          parentID,
          labelmap,
          // Identity is chosen by name, so explicit descriptions must precede
          // binding to a segment shared by other images.
          descriptors.map((descriptor) => ({
            ...descriptor,
            ...bySourceValue.get(descriptor.value),
          })),
          { source }
        );
        return created.map((mask) => mask.id);
      },
    });
    const ontoParents =
      conversions.get(imageID) ?? new Map<DataSelection, typeof conversion>();
    conversions.set(imageID, ontoParents.set(parentID, conversion));
    try {
      return await conversion;
    } finally {
      ontoParents.delete(parentID);
      // The child is still converting while it goes onto another parent.
      if (ontoParents.size === 0) conversions.delete(imageID);
    }
  }

  /**
   * Starts a conversion nobody awaits, and reports its failure. A conversion
   * outlives the load or the click that started it, and the parent image can
   * be removed while the resample runs, so the rejection needs somewhere to
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
  const ensureLabelmapBinding = (maskId: string) =>
    getMask(maskId).representations.labelmap ?? allocateMaskBinding(maskId);

  const findMaskBinding = (maskId: string) =>
    findMask(maskId)?.representations.labelmap;

  // Editor state, not document state: it is never serialized.
  const allowOverlap = ref(false);

  const { maskVoxels, findMaskVoxels, voxelClaim } = createVoxelAccess({
    parentImageOfMask,
    findMaskBinding,
    getMask,
    segmentationOfMask,
    ensureLabelmapBinding,
    maskLocked,
    overlapAllowed: () => allowOverlap.value,
  });

  /** The image's masks in `order`, or none when it has no segmentation. */
  function imageMasks(parentImageId: string) {
    const segmentation = getSegmentationForImage(parentImageId);
    return segmentation ? listMasks(segmentation) : [];
  }

  /**
   * The masks of an image a process may edit: unlocked, since a locked segment
   * is not editable, and holding voxels, since an empty mask has no content to
   * process.
   */
  const editableMasks = (parentImageId: string) =>
    imageMasks(parentImageId)
      .filter((mask) => !maskLocked(mask) && maskHasContent(mask))
      .map((mask) => mask.id);

  /**
   * The ids of the masks an image draws, in `order`. One actor each; they are
   * translucent, so the renderer blends them rather than stacking them by this
   * order.
   */
  const boundMaskIds = (parentImageId: string) =>
    imageMasks(parentImageId)
      .filter((mask) => mask.representations.labelmap)
      .map((mask) => mask.id);

  const updateSegmentationDisplay = (
    segmentationId: string,
    patch: SegmentationDisplayPatch
  ) => Object.assign(getSegmentation(segmentationId), patch);

  /** The mask holds this segment and nothing else, so its voxels go with it. */
  function deleteMask(maskId: string) {
    const segmentation = getSegmentationOfMask(maskId);
    edits.beforeEdit();
    const { segmentId, representations } = segmentation.masks[maskId];
    removeFromArray(segmentation.order, maskId);
    delete segmentation.masks[maskId];
    const index = maskIdsBySegment.get(segmentation.id);
    if (index?.get(segmentId) === maskId) index.delete(segmentId);
    if (representations.labelmap)
      releaseMaskName(representations.labelmap.name);
  }

  /**
   * Deletes each of these masks that holds no voxel, since an erase never
   * shrinks the allocation that content is read from. Edits call it once they
   * end, with the masks they wrote or cleared; an id already gone is skipped.
   */
  function deleteEmptyMasks(maskIds: Iterable<string>) {
    new Set(maskIds).forEach((maskId) => {
      const binding = findMaskBinding(maskId);
      if (binding && !hasMarkedVoxel(maskScalars(binding.image)))
        deleteMask(maskId);
    });
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

  /** Whether a mask id is live anywhere, used to tell stale ids from foreign ones. */
  const maskExists = (maskId: string) => !!findMask(maskId);

  // A segment the caller named that no longer exists is a stale reference, not
  // a target: the edit falls through to the selected one.
  const targetSegmentId = (preferredSegmentId: Maybe<string>) =>
    segmentRegistry.getSegment(preferredSegmentId)?.id ??
    segmentRegistry.selectedSegmentId.value;

  /**
   * The mask an edit would land in, if it already exists. Creates nothing, so
   * an operation with nothing to allocate for, erasing above all, can refuse
   * before a mask is created.
   */
  function findEditTarget(imageId: string, preferredSegmentId?: Maybe<string>) {
    return maskFor(imageId, targetSegmentId(preferredSegmentId))?.id;
  }

  /**
   * Whether the segment an edit would land in is locked. The refusal cannot
   * wait for a resolved mask: `resolveEditTarget` returns a mask id, so it has
   * to mint the record and its segmentation before anything can be asked about
   * the lock, and a refused edit would leave both behind. This answers from the
   * segment alone, creating nothing, so every edit path can refuse first.
   */
  const editTargetLocked = (preferredSegmentId?: Maybe<string>) =>
    segmentLocked(targetSegmentId(preferredSegmentId));

  /**
   * Resolves or creates the mask an edit targets. With no segments the first
   * edit mints one, then takes this image's mask of it. Callers refusing a
   * locked segment ask `editTargetLocked` before this.
   */
  function resolveEditTarget(
    imageId: string,
    preferredSegmentId?: Maybe<string>
  ) {
    edits.beforeEdit();
    const segmentId =
      targetSegmentId(preferredSegmentId) ??
      segmentRegistry.ensureSelectedSegment();
    return ensureMask(imageId, segmentId).id;
  }

  const maskIdsOfSegment = (segmentId: string) =>
    Object.values(segmentations).flatMap((segmentation) => {
      const maskId = maskIdsBySegment.get(segmentation.id)?.get(segmentId);
      return maskId ? [maskId] : [];
    });

  segmentRegistry.declareReferences('labelmaps', {
    has: (segmentId) => maskIdsOfSegment(segmentId).length > 0,
    remove: (segmentId) =>
      maskIdsOfSegment(segmentId).forEach((maskId) => deleteMask(maskId)),
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
    allocateMaskBinding,
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
    convertingLabelmaps: readonly(conversions),
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
    splitLabelmapIntoMasks,
    decodeSegments,
    convertImageToLabelmap,
    startLabelmapConversion,
    saveFormat,
    allowOverlap,
    voxelClaim,
    deleteEmptyMasks,
    imageMasks,
    editableMasks,
    boundMaskIds,
    serialize,
    deserialize,
  };
});
