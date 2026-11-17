import { computed, ref, shallowReactive, shallowRef } from 'vue';

import { useIdStore } from '@/src/store/id';
import type { Maybe } from '@/src/types';
import {
  resolveSegmentAppearance,
  type Segment,
  type SegmentInit,
} from '@/src/segmentation/segment';
import { cleanUndefined } from '@/src/utils';
import type { ImageSegments } from '@/src/segmentation/model';
import { createImageStorage } from '@/src/segmentation/imageStorage';
import { createNameIndex } from '@/src/segmentation/segmentNames';
import {
  configuredColor,
  copiedAppearance,
  fromConfigured,
} from '@/src/segmentation/segmentConfig';
import type { ConfiguredSegments } from '@/src/io/import/configSegments';

export type SeatOptions = {
  // A segment holds at most one mask, so a masked arrival skips a masked match.
  withMask?: boolean;
  appearance?: 'existing' | 'incoming';
};

type RegistryOptions = {
  // Only an image the app holds starts from the config.
  imageExists?: (imageId: string) => boolean;
  // A held preview writes into the storage a removal is about to drop.
  beforeMaskRemoval?: () => void;
};

type SegmentReferenceHolder = {
  holds: (segmentId: string) => boolean;
  remove: (segmentId: string) => void;
};

export type RestoredSegment = Segment & { withMask?: boolean };

/**
 * Each image owns the segments its paint, rectangles, polygons and rulers
 * reference, and the masks holding their voxels. Explicit order drives the
 * picker, shortcuts, export precedence and every walk over the masks.
 */
export const createSegmentRegistry = ({
  imageExists = () => true,
  beforeMaskRemoval = () => {},
}: RegistryOptions = {}) => {
  // Stores holding shapes declare them here; the registry does not know them.
  const referenceHolders = new Map<string, SegmentReferenceHolder>();
  const declareReferences = (name: string, holder: SegmentReferenceHolder) => {
    referenceHolders.set(name, holder);
  };

  const imageSets = ref<Record<string, ImageSegments>>(Object.create(null));
  const configTemplate = shallowRef<ConfiguredSegments>({});
  // Reactive: a computed that looked up a segment before it existed must rerun.
  const owners = shallowReactive(new Map<string, string>());
  const setOf = (id: Maybe<string>) => {
    const imageId = id ? owners.get(id) : undefined;
    return imageId ? imageSets.value[imageId] : undefined;
  };
  // Runtime metadata and cached lookups live and go with the image's set.
  const newMetadata = (imageId: string) => ({
    names: createNameIndex(),
    nextColorIndex: 0,
    order: computed(
      () =>
        new Map(
          (imageSets.value[imageId]?.order ?? []).map((id, at) => [id, at])
        )
    ),
    segments: computed(() => {
      const set = imageSets.value[imageId];
      return set ? set.order.map((id) => set.segments[id]) : [];
    }),
  });
  const metadataByImage = new Map<string, ReturnType<typeof newMetadata>>();

  const metadataFor = (imageId: string) => {
    const metadata = metadataByImage.get(imageId) ?? newMetadata(imageId);
    metadataByImage.set(imageId, metadata);
    return metadata;
  };

  const ensureUnseededSet = (imageId: string) => {
    imageSets.value[imageId] ??= {
      order: [],
      selectionRevision: 0,
      segments: Object.create(null),
      masks: new Map(),
    };
    return imageSets.value[imageId];
  };

  // Annotated: seeding seats segments, which call back in here.
  const ensureSet = (imageId: string): ImageSegments => {
    const existing = imageSets.value[imageId];
    if (existing) return existing;
    const set = ensureUnseededSet(imageId);
    if (imageExists(imageId)) applyConfigTo(imageId, configTemplate.value);
    return set;
  };

  const segmentList = (imageId: Maybe<string>) =>
    imageId && imageSets.value[imageId]
      ? metadataFor(imageId).segments.value
      : [];

  const ownerImageId = (id: Maybe<string>) => (id ? owners.get(id) : undefined);
  const belongsToImage = (imageId: Maybe<string>, id: Maybe<string>) =>
    !!imageId && !!id && ownerImageId(id) === imageId;
  const assertBelongsToImage = (imageId: Maybe<string>, id: Maybe<string>) => {
    if (id && !belongsToImage(imageId, id))
      throw new Error('Segment belongs to another image');
  };

  const getSegment = (id: Maybe<string>) =>
    id ? setOf(id)?.segments[id] : undefined;

  const selectionRevision = (imageId: Maybe<string>) =>
    imageId ? (imageSets.value[imageId]?.selectionRevision ?? 0) : 0;

  const selectedSegmentId = (imageId: Maybe<string>) => {
    const set = imageId ? imageSets.value[imageId] : undefined;
    return set?.selected ?? set?.order[0];
  };

  const selectSegment = (id: Maybe<string>) => {
    const imageId = ownerImageId(id);
    if (!imageId || !id) return;
    const set = ensureSet(imageId);
    set.selected = id;
    // Reselecting the same segment can still request that its row be revealed.
    set.selectionRevision += 1;
  };

  const appearanceOf = (id: Maybe<string>) =>
    resolveSegmentAppearance(getSegment(id));

  // Cached per image: the export sort asks twice per comparison.
  const orderIndexOf = (id: string) => {
    const imageId = ownerImageId(id);
    return imageId ? (metadataFor(imageId).order.value.get(id) ?? -1) : -1;
  };

  const findSegmentByName = (imageId: string, name: string) =>
    getSegment(metadataByImage.get(imageId)?.names.idNamed(name));

  /** Mints a segment without choosing it. Allocates no voxels. */
  const mintSegment = (imageId: string, init: SegmentInit = {}) => {
    const set = ensureSet(imageId);
    const metadata = metadataFor(imageId);
    const { names } = metadata;
    const id = useIdStore().nextId();
    const { name, ...stated } = cleanUndefined(init);
    // Mutated in place: a copy per mint makes a large import quadratic.
    const segment = {
      color: configuredColor(metadata.nextColorIndex++),
      visible: true,
      locked: false,
      ...stated,
      name: name === undefined ? names.defaultName() : names.uniqueName(name),
      id,
    };
    set.segments[id] = segment;
    set.order.push(id);
    owners.set(id, imageId);
    names.add(segment.name, id);
    return id;
  };

  const addSegment = (imageId: string, init: SegmentInit = {}) => {
    const id = mintSegment(imageId, init);
    selectSegment(id);
    return id;
  };

  const updateSegment = (id: string, patch: SegmentInit) => {
    const set = setOf(id);
    const segment = set?.segments[id];
    if (!segment) return;
    const name =
      patch.name === undefined || patch.name.trim() === segment.name
        ? segment.name
        : metadataFor(ownerImageId(id)!).names.rename(
            id,
            segment.name,
            patch.name
          );
    set.segments[id] = {
      ...segment,
      ...patch,
      // Undefined resets an optional appearance field, not a required one.
      name,
      color: patch.color ?? segment.color,
      visible: patch.visible ?? segment.visible,
      locked: patch.locked ?? segment.locked,
      id,
    };
  };

  const storage = createImageStorage({
    imageSets,
    setOf,
    ensureSet,
    beforeMaskRemoval,
  });
  const { forgetMasks, ...masksAndDisplay } = storage;
  const { maskOf, removeMask } = storage;

  // Deleting a referenced segment takes its mask and shapes with it; the
  // caller owns the confirmation.
  const deleteSegment = (id: string) => {
    const set = setOf(id);
    const segment = set?.segments[id];
    if (!set || !segment) return;
    removeMask(id);
    referenceHolders.forEach((holder) => holder.remove(id));
    const imageId = ownerImageId(id)!;
    set.order = set.order.filter((key) => key !== id);
    if (set.selected === id) delete set.selected;
    metadataFor(imageId).names.remove(segment.name);
    owners.delete(id);
    delete set.segments[id];
  };

  const moveSegment = (id: string, target: string, after = false) => {
    const imageId = ownerImageId(id);
    if (!imageId || id === target || !belongsToImage(imageId, target)) return;
    const set = ensureSet(imageId);
    const order = set.order.filter((key) => key !== id);
    order.splice(order.indexOf(target) + Number(after), 0, id);
    set.order = order;
  };

  const nextSegmentColor = (imageId: string) =>
    configuredColor(metadataByImage.get(imageId)?.nextColorIndex ?? 0);

  const ensureSelectedSegment = (imageId: string) => {
    ensureSet(imageId);
    return selectedSegmentId(imageId) ?? mintSegment(imageId);
  };

  /**
   * Seats an incoming definition by name: it joins the segment of that name
   * unless both hold a mask. Otherwise it is minted under a free name.
   */
  const seatSegment = (
    imageId: string,
    init: SegmentInit & { name: string },
    { withMask = false, appearance = 'existing' }: SeatOptions = {}
  ) => {
    ensureSet(imageId);
    const existing = findSegmentByName(imageId, init.name)?.id;
    if (!existing || (withMask && maskOf(existing)))
      return mintSegment(imageId, init);
    if (appearance === 'incoming') updateSegment(existing, init);
    return existing;
  };

  // Stated fields only, so nothing the config omits is reset.
  function applyConfigTo(imageId: string, configured: ConfiguredSegments) {
    Object.entries(configured).forEach(([name, props]) =>
      seatSegment(imageId, fromConfigured(name, props), {
        appearance: 'incoming',
      })
    );
  }

  /** New sets start from the config; sets already here gain its segments. */
  const applyConfig = (configured: ConfiguredSegments | null) => {
    configTemplate.value = configured ?? {};
    Object.keys(imageSets.value).forEach((imageId) =>
      applyConfigTo(imageId, configTemplate.value)
    );
  };

  // A restore ends with this, so a config loaded earlier lands like a later one.
  const applyTemplate = (imageId: Maybe<string>) => {
    if (imageId && imageSets.value[imageId])
      applyConfigTo(imageId, configTemplate.value);
  };

  // Definitions only: a same-named target segment stays exactly as it is.
  const copySegments = (targetId: string, sourceId: string) =>
    segmentList(sourceId).forEach((segment) =>
      seatSegment(targetId, {
        ...copiedAppearance(segment),
        name: segment.name,
      })
    );

  // Image eviction also notifies each shape store, which removes its own tools
  // by image. The segments and their masks go here.
  const removeImage = (imageId: string) => {
    const set = imageSets.value[imageId];
    if (!set) return;
    forgetMasks(set);
    delete imageSets.value[imageId];
    set.order.forEach((id) => owners.delete(id));
    metadataByImage.delete(imageId);
  };

  const inUse = (id: string) =>
    !!maskOf(id) ||
    [...referenceHolders.values()].some((holder) => holder.holds(id));

  // A segment in use keeps its look, and a restored mask never joins it.
  const joinRestored = (id: string, init: SegmentInit, withMask: boolean) => {
    const used = inUse(id);
    if (withMask && used) return undefined;
    if (!used) updateSegment(id, init);
    return id;
  };

  /**
   * Seats restored segments by name and maps each saved id to its segment. A
   * repeated id is the segment its first entry made.
   */
  const adopt = (imageId: string, incoming: RestoredSegment[]) => {
    ensureUnseededSet(imageId);
    const idMap = new Map<string, string>();
    // Two saved segments of one name stay two segments.
    const seated = new Set<string>();
    incoming.forEach(({ id, withMask = false, ...saved }) => {
      if (idMap.has(id)) return;
      const init = {
        fillOpacity: undefined,
        outlineOpacity: undefined,
        strokeWidth: undefined,
        ...saved,
      };
      const sameName = findSegmentByName(imageId, init.name)?.id;
      const joined =
        sameName && !seated.has(sameName)
          ? joinRestored(sameName, init, withMask)
          : undefined;
      const target = joined ?? mintSegment(imageId, init);
      seated.add(target);
      idMap.set(id, target);
    });
    return idMap;
  };

  /** Selects a restored segment unless the user already chose one. */
  const restoreSelection = (imageId: string, id: Maybe<string>) => {
    if (belongsToImage(imageId, id) && !imageSets.value[imageId]?.selected)
      selectSegment(id);
  };

  return {
    imageSets,
    ownerImageId,
    belongsToImage,
    assertBelongsToImage,
    removeImage,
    segmentList,
    selectedSegmentId,
    selectionRevision,
    selectSegment,
    restoreSelection,
    getSegment,
    appearanceOf,
    orderIndexOf,
    findSegmentByName,
    ensureSet,
    mintSegment,
    addSegment,
    updateSegment,
    moveSegment,
    deleteSegment,
    ensureSelectedSegment,
    nextSegmentColor,
    seatSegment,
    configTemplate,
    applyConfig,
    applyTemplate,
    copySegments,
    adopt,
    declareReferences,
    ...masksAndDisplay,
  };
};

export type SegmentRegistry = ReturnType<typeof createSegmentRegistry>;
