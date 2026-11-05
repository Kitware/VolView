import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { RGBAColor } from '@kitware/vtk.js/types';

import { TOOL_COLORS } from '@/src/config';
import { useIdStore } from '@/src/store/id';
import type { Maybe } from '@/src/types';
import { cssColorToRGBA, tryCssColorToRGBA } from '@/src/segmentation/color';
import {
  resolveSegmentAppearance,
  type Segment,
  type SegmentInit,
} from '@/src/segmentation/segment';
import { arrayEquals, cleanUndefined, omit } from '@/src/utils';
import { makeDefaultSegmentName } from '@/src/segmentation/model';
import type { ConfiguredSegments } from '@/src/io/import/configSegments';

type ImageSegmentSet = {
  segmentIds: string[];
  selectedSegmentId?: string;
  selectionRevision: number;
};

export type SegmentDefaults = Omit<
  Segment,
  'id' | 'color' | 'visible' | 'locked'
> & {
  color?: RGBAColor;
};

type SegmentSetSnapshot = {
  segments: SegmentInit[];
  selectedIndex?: number;
  nextColorIndex?: number;
  configured: Array<Omit<ConfigEntry, 'id'> & { name: string; index: number }>;
};

type ConfigEntry = {
  id: string;
  appearance: ReturnType<typeof configuredAppearance>;
  contribution: Partial<SegmentDefaults>;
  minted: boolean;
};

type SegmentReferenceHolder = {
  has: (segmentId: string) => boolean;
  remove: (segmentId: string) => void;
};

// An unparseable color is left out, so the segment keeps the color it has.
const fromConfigured = (
  name: string,
  configured: ConfiguredSegments[string]
) => ({
  ...cleanUndefined({
    color: configured.color ? tryCssColorToRGBA(configured.color) : undefined,
    fillOpacity: configured.fillOpacity,
    outlineOpacity: configured.outlineOpacity,
    strokeWidth: configured.strokeWidth,
  }),
  name,
});

type Appearance = Pick<
  Segment,
  'color' | 'fillOpacity' | 'outlineOpacity' | 'strokeWidth'
>;

const configuredAppearance = ({
  color,
  fillOpacity,
  outlineOpacity,
  strokeWidth,
}: Appearance) => ({ color, fillOpacity, outlineOpacity, strokeWidth });

// Palette colors wrap when an image exhausts the available colors.
const configuredColor = (index: number) =>
  cssColorToRGBA(TOOL_COLORS[index % TOOL_COLORS.length]);

export const withCopiedColor = <T extends { color?: RGBAColor }>(
  segment: T
): T => ({
  ...segment,
  ...(segment.color ? { color: [...segment.color] as RGBAColor } : {}),
});

/** The definitions a config gives an image that has no earlier set to copy. */
export const defaultsFromConfig = (configured: ConfiguredSegments) =>
  Object.entries(configured).map(([name, props]) =>
    fromConfigured(name, props)
  );

const configuredEntry = (
  { name, color, fillOpacity, outlineOpacity, strokeWidth }: SegmentDefaults,
  index: number
) => ({
  appearance: configuredAppearance({ color: configuredColor(index) }),
  contribution: cleanUndefined({
    name,
    color,
    fillOpacity,
    outlineOpacity,
    strokeWidth,
  }),
  minted: true,
});

/** Seeds defaults as config-minted segments, as the config itself would. */
export const snapshotFromDefaults = (
  defaults: readonly SegmentDefaults[]
): SegmentSetSnapshot => ({
  segments: [...defaults],
  configured: defaults.map((segment, index) => ({
    name: segment.name,
    index,
    ...configuredEntry(segment, index),
  })),
});

/**
 * Each image owns the segments its paint, rectangles, polygons and rulers
 * reference. Explicit order drives the picker, shortcuts and export precedence.
 */
export const createSegmentRegistry = (
  beforeEdit: (imageId: string) => void = () => {}
) => {
  // Stores holding masks or shapes declare them here; the registry knows neither.
  const referenceHolders = new Map<string, SegmentReferenceHolder>();
  const declareReferences = (name: string, holder: SegmentReferenceHolder) => {
    referenceHolders.set(name, holder);
  };
  const hasReferences = (segmentId: string) =>
    [...referenceHolders.values()].some((holder) => holder.has(segmentId));
  const removeReferences = (segmentId: string) =>
    referenceHolders.forEach((holder) => holder.remove(segmentId));

  const segmentById = ref<Record<string, Segment>>(Object.create(null)) as Ref<
    Record<string, Segment>
  >;
  const imageSets = ref<Record<string, ImageSegmentSet>>(Object.create(null));
  const owners = new Map<string, string>();
  // Runtime metadata and cached lookups live and go with the image's set.
  const metadataByImage = new Map<
    string,
    {
      // An untouched inherited set can be replaced by incoming definitions.
      borrowed: boolean;
      idsByName: Map<string, string[]>;
      suffixFloors: Map<string, number>;
      nextColorIndex: number;
      config: Map<string, ConfigEntry>;
      order: ComputedRef<Map<string, number>>;
      segments: ComputedRef<Segment[]>;
    }
  >();

  const metadataFor = (imageId: string) => {
    let metadata = metadataByImage.get(imageId);
    if (!metadata) {
      metadata = {
        borrowed: false,
        idsByName: new Map(),
        suffixFloors: new Map(),
        nextColorIndex: 0,
        config: new Map(),
        order: computed(
          () =>
            new Map(
              (imageSets.value[imageId]?.segmentIds ?? []).map((id, at) => [
                id,
                at,
              ])
            )
        ),
        segments: computed(() =>
          (imageSets.value[imageId]?.segmentIds ?? []).map(
            (id) => segmentById.value[id]
          )
        ),
      };
      metadataByImage.set(imageId, metadata);
    }
    return metadata;
  };

  const ensureSet = (imageId: string) => {
    imageSets.value[imageId] ??= { segmentIds: [], selectionRevision: 0 };
    return imageSets.value[imageId];
  };

  const segmentList = (imageId: Maybe<string>) =>
    imageId && imageSets.value[imageId]
      ? metadataFor(imageId).segments.value
      : [];

  const ownerImageId = (id: Maybe<string>) => (id ? owners.get(id) : undefined);
  const belongsToImage = (imageId: Maybe<string>, id: Maybe<string>) =>
    !!imageId && !!id && ownerImageId(id) === imageId;

  const indexName = (imageId: string, name: string, id: string) => {
    const { idsByName } = metadataFor(imageId);
    const key = name.trim();
    const ids = idsByName.get(key);
    if (ids) ids.push(id);
    else idsByName.set(key, [id]);
  };

  // Releasing a name may free a suffix below its family's cached floor.
  const unindexName = (imageId: string, name: string, id: string) => {
    const { idsByName, suffixFloors } = metadataFor(imageId);
    const key = name.trim();
    const ids = idsByName.get(key);
    if (!ids) return;
    const at = ids.indexOf(id);
    if (at !== -1) ids.splice(at, 1);
    if (ids.length === 0) idsByName.delete(key);
    suffixFloors.clear();
  };

  const nameTaken = (imageId: string, name: string) =>
    metadataFor(imageId).idsByName.has(name);

  const getSegment = (id: Maybe<string>) =>
    id ? segmentById.value[id] : undefined;

  const selectionRevision = (imageId: Maybe<string>) =>
    imageId ? (imageSets.value[imageId]?.selectionRevision ?? 0) : 0;

  const selectedSegmentId = (imageId: Maybe<string>) => {
    const set = imageId ? imageSets.value[imageId] : undefined;
    return set?.selectedSegmentId ?? set?.segmentIds[0];
  };

  const selectSegment = (id: Maybe<string>) => {
    const imageId = ownerImageId(id);
    if (!imageId || !id) return;
    const set = ensureSet(imageId);
    set.selectedSegmentId = id;
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

  const findSegmentByName = (imageId: string, name: string) => {
    const matches = (
      metadataFor(imageId).idsByName.get(name.trim()) ?? []
    ).filter((id) => segmentById.value[id]?.name === name);
    const [first] = matches.sort((a, b) => orderIndexOf(a) - orderIndexOf(b));
    return getSegment(first);
  };

  // `family` keys the floor: every name `nameFor` gives belongs to it.
  const lowestFreeName = (
    imageId: string,
    family: string,
    nameFor: (index: number) => string,
    first: number
  ) => {
    const { suffixFloors } = metadataFor(imageId);
    let index = suffixFloors.get(family) ?? first;
    while (nameTaken(imageId, nameFor(index))) index += 1;
    suffixFloors.set(family, index);
    return nameFor(index);
  };

  // The name index and every lookup ignore surrounding space, so the stem has
  // to be trimmed as well.
  const uniqueName = (imageId: string, stem: string) => {
    const base = stem.trim();
    return nameTaken(imageId, base)
      ? lowestFreeName(imageId, `${base} (`, (index) => `${base} (${index})`, 2)
      : base;
  };

  // A stem family ends in ' (', so this key never collides with one.
  const defaultName = (imageId: string) =>
    lowestFreeName(imageId, 'default', makeDefaultSegmentName, 1);

  /** Mints a segment without choosing it. Allocates no voxels. */
  const mintSegment = (imageId: string, init: SegmentInit = {}) => {
    const set = ensureSet(imageId);
    const id = useIdStore().nextId();
    const stated = cleanUndefined(init);
    // Mutated in place: a copy per mint makes a large import quadratic.
    const segment = {
      name: stated.name ?? defaultName(imageId),
      color: configuredColor(metadataFor(imageId).nextColorIndex++),
      visible: true,
      locked: false,
      ...stated,
      id,
    };
    segmentById.value[id] = segment;
    markEdited(imageId);
    set.segmentIds.push(id);
    owners.set(id, imageId);
    indexName(imageId, segment.name, id);
    return id;
  };

  const addSegment = (imageId: string, init: SegmentInit = {}) => {
    beforeEdit(imageId);
    const id = mintSegment(imageId, init);
    selectSegment(id);
    return id;
  };

  const markEdited = (imageId: string) => {
    const metadata = metadataByImage.get(imageId);
    if (metadata) metadata.borrowed = false;
  };

  const updateSegment = (id: string, patch: SegmentInit) => {
    const segment = segmentById.value[id];
    if (!segment) return;
    const next = {
      ...segment,
      ...patch,
      // Undefined resets an optional appearance field, not a required one.
      name: patch.name ?? segment.name,
      color: patch.color ?? segment.color,
      visible: patch.visible ?? segment.visible,
      locked: patch.locked ?? segment.locked,
      id,
    };
    const unchanged = Object.keys(next).every((key) =>
      key === 'color'
        ? arrayEquals(next.color, segment.color)
        : next[key as keyof Segment] === segment[key as keyof Segment]
    );
    if (unchanged) return;
    markEdited(ownerImageId(id)!);
    if (next.name !== segment.name) {
      const imageId = ownerImageId(id)!;
      unindexName(imageId, segment.name, id);
      indexName(imageId, next.name, id);
    }
    segmentById.value[id] = next;
  };

  // Deleting a referenced segment takes its masks and shapes with it; the
  // caller owns the confirmation.
  const deleteSegment = (id: string) => {
    const segment = segmentById.value[id];
    if (!segment) return;
    removeReferences(id);
    const imageId = ownerImageId(id)!;
    markEdited(imageId);
    const set = ensureSet(imageId);
    set.segmentIds = set.segmentIds.filter((key) => key !== id);
    if (set.selectedSegmentId === id) delete set.selectedSegmentId;
    unindexName(imageId, segment.name, id);
    owners.delete(id);
    delete segmentById.value[id];
  };

  const moveSegment = (id: string, target: string, after = false) => {
    const imageId = ownerImageId(id);
    if (!imageId || id === target || !belongsToImage(imageId, target)) return;
    markEdited(imageId);
    const set = ensureSet(imageId);
    const order = set.segmentIds.filter((key) => key !== id);
    order.splice(order.indexOf(target) + Number(after), 0, id);
    set.segmentIds = order;
  };

  const nextSegmentColor = (imageId: Maybe<string>) =>
    configuredColor(
      imageId ? (metadataByImage.get(imageId)?.nextColorIndex ?? 0) : 0
    );

  const ensureSelectedSegment = (imageId: string) => {
    beforeEdit(imageId);
    return selectedSegmentId(imageId) ?? mintSegment(imageId);
  };

  const segmentNamed = (
    imageId: string,
    name: string,
    init: SegmentInit = {}
  ) => {
    const existing = findSegmentByName(imageId, name);
    if (existing) return existing.id;
    return mintSegment(imageId, { ...init, name });
  };

  // Updates replace records and colors; initialization copies the captured
  // values into each destination's independently owned arrays.
  const snapshot = (imageId: string): SegmentSetSnapshot => {
    const segments = segmentList(imageId);
    const metadata = metadataByImage.get(imageId);
    const indexesById = metadata?.order.value;
    const selectedIndex = indexesById?.get(
      imageSets.value[imageId]?.selectedSegmentId ?? ''
    );
    return {
      segments: segments.map((segment) => omit(segment, ['id'])),
      ...(selectedIndex === undefined ? {} : { selectedIndex }),
      nextColorIndex: metadata?.nextColorIndex ?? 0,
      configured: [...(metadata?.config ?? [])].flatMap(
        ([name, { id, ...entry }]) => {
          const index = indexesById?.get(id);
          return index === undefined ? [] : [{ ...entry, name, index }];
        }
      ),
    };
  };

  const initializeSet = (
    imageId: string,
    source: SegmentSetSnapshot,
    { copied = false } = {}
  ) => {
    if (imageSets.value[imageId]) return;
    const set = ensureSet(imageId);
    source.segments.forEach((segment) =>
      mintSegment(imageId, {
        ...withCopiedColor(segment),
        visible: true,
        locked: false,
      })
    );
    if (source.nextColorIndex !== undefined)
      metadataFor(imageId).nextColorIndex = source.nextColorIndex;
    if (source.selectedIndex !== undefined)
      selectSegment(set.segmentIds[source.selectedIndex]);
    source.configured.forEach(({ name, index, ...entry }) => {
      const id = set.segmentIds[index];
      if (id)
        metadataFor(imageId).config.set(name, {
          ...entry,
          id,
          appearance: withCopiedColor(entry.appearance),
          contribution: withCopiedColor(entry.contribution),
        });
    });
    if (copied) metadataFor(imageId).borrowed = true;
  };

  // --- config overlay --- //

  // Keep each key's identity and appearance beneath its config contribution.
  // New segments begin with automatic color and default optional appearance;
  // a restored segment begins with its session appearance.
  const overlayConfig = (imageId: string, name: string, entry: ConfigEntry) => {
    metadataFor(imageId).config.set(name, entry);
    updateSegment(entry.id, { ...entry.appearance, ...entry.contribution });
  };

  const seatConfigured = (imageId: string, contribution: SegmentDefaults) => {
    const { name } = contribution;
    const matched = findSegmentByName(imageId, name);
    const id = matched?.id ?? mintSegment(imageId, { name });
    return {
      id,
      appearance: configuredAppearance(getSegment(id)!),
      contribution,
      minted: !matched,
    };
  };

  const replaceConfigSegments = (
    imageId: string,
    configured: Maybe<ConfiguredSegments>
  ) => {
    ensureSet(imageId);
    const entries = metadataFor(imageId).config;
    const next = configured ?? {};

    Object.entries(next).forEach(([name, props]) => {
      const held = entries.get(name);
      const contribution = fromConfigured(name, props);
      overlayConfig(
        imageId,
        name,
        held && getSegment(held.id)
          ? { ...held, contribution }
          : seatConfigured(imageId, contribution)
      );
    });

    [...entries.entries()]
      .filter(([name]) => !Object.hasOwn(next, name))
      .forEach(([name, { id, minted }]) => {
        entries.delete(name);
        // Content keeps its last configured appearance; a segment the config
        // matched by name rather than minted is not the config's to drop.
        if (minted && segmentById.value[id] && !hasReferences(id))
          deleteSegment(id);
      });
  };

  // --- wire --- //

  const serialize = () =>
    Object.values(imageSets.value).flatMap(({ segmentIds }) =>
      segmentIds.map((id) => ({ ...segmentById.value[id] }))
    );

  // Image eviction also notifies each content store, which removes its own
  // masks and tools by image. Only the segment metadata belongs here.
  const removeImage = (imageId: string) => {
    const ids = imageSets.value[imageId]?.segmentIds ?? [];
    delete imageSets.value[imageId];
    ids.forEach((id) => {
      owners.delete(id);
      delete segmentById.value[id];
    });
    metadataByImage.delete(imageId);
  };

  /** Drops a copied set that no user edit or incoming content has claimed. */
  const releaseBorrowed = (imageId: string) => {
    const ids = imageSets.value[imageId]?.segmentIds ?? [];
    if (metadataByImage.get(imageId)?.borrowed && !ids.some(hasReferences))
      removeImage(imageId);
  };

  // The session's appearance replaces the reused segment's own and a config
  // holding the segment layers over it, as if the session had been restored
  // first.
  const restoreOnto = (id: string, init: SegmentInit) => {
    updateSegment(id, {
      fillOpacity: undefined,
      outlineOpacity: undefined,
      strokeWidth: undefined,
      ...init,
    });
    const imageId = ownerImageId(id)!;
    const held = [...metadataFor(imageId).config].find(
      ([, entry]) => entry.id === id
    );
    // Now the session's segment as well, so dropping the key must not take it.
    if (held)
      overlayConfig(imageId, held[0], {
        ...held[1],
        appearance: configuredAppearance(getSegment(id)!),
        minted: false,
      });
    return id;
  };

  /**
   * Seats restored segments and returns the idMap every incoming reference is
   * remapped through. An incoming segment joins the first existing segment of
   * its name on this image when that one holds no mask or shape, restoring its
   * own appearance onto it; otherwise it is minted under a unique name, so
   * content already here keeps its segment. `repeated` lists the entries left
   * unseated because an earlier one claimed their id. Shared `claimedTargets`
   * keep distinct identities when several saved sets resolve to one image.
   */
  const adopt = (
    imageId: string,
    incoming: Maybe<Segment[]>,
    claimedTargets = new Set<string>()
  ) => {
    ensureSet(imageId);
    // Prototype-free: a file's ids are its own, so an id spelling an
    // Object.prototype key ('constructor', 'toString') must not read as
    // already seen here, nor hand a caller an inherited member in place of a
    // miss when it looks the id up in the returned map.
    const idMap: Record<string, string> = Object.create(null);
    const repeated: Segment[] = [];
    const reusable = (name: string) => {
      const existing = findSegmentByName(imageId, name)?.id;
      return existing &&
        !claimedTargets.has(existing) &&
        !hasReferences(existing)
        ? existing
        : undefined;
    };
    (incoming ?? []).forEach((segment) => {
      const { id, ...init } = segment;
      // Nothing makes a file's ids unique, and only one segment can answer for
      // an id. The first entry wins; minting the rest as well would leave
      // segments in the sidebar that no mask or shape can ever reference.
      if (Object.hasOwn(idMap, id)) {
        repeated.push(segment);
        return;
      }
      const reused = reusable(init.name);
      const target = reused
        ? restoreOnto(reused, init)
        : mintSegment(imageId, {
            ...init,
            name: uniqueName(imageId, init.name),
          });
      claimedTargets.add(target);
      idMap[id] = target;
    });
    return { idMap, repeated };
  };

  /** Selects a restored segment unless the user already chose one. */
  const restoreSelection = (imageId: string, id: Maybe<string>) => {
    if (
      belongsToImage(imageId, id) &&
      !imageSets.value[imageId]?.selectedSegmentId
    )
      selectSegment(id);
  };

  return {
    imageSets,
    initializeSet,
    snapshot,
    belongsToImage,
    removeImage,
    releaseBorrowed,
    segmentList,
    selectedSegmentId,
    selectionRevision,
    selectSegment,
    restoreSelection,
    getSegment,
    appearanceOf,
    orderIndexOf,
    findSegmentByName,
    uniqueName,
    mintSegment,
    addSegment,
    updateSegment,
    markEdited,
    moveSegment,
    deleteSegment,
    ensureSelectedSegment,
    nextSegmentColor,
    segmentNamed,
    replaceConfigSegments,
    serialize,
    adopt,
    declareReferences,
  };
};

export type SegmentRegistry = ReturnType<typeof createSegmentRegistry>;
