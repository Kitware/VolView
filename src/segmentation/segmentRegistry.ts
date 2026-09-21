import { computed, ref, type Ref } from 'vue';

import { TOOL_COLORS } from '@/src/config';
import { useIdStore } from '@/src/store/id';
import type { Maybe } from '@/src/types';
import { cssColorToRGBA, tryCssColorToRGBA } from '@/src/segmentation/color';
import {
  resolveSegmentAppearance,
  type Segment,
  type SegmentInit,
} from '@/src/segmentation/segment';
import { cleanUndefined, cycle } from '@/src/utils';
import { makeDefaultSegmentName } from '@/src/segmentation/model';
import type { ConfiguredSegments } from '@/src/io/import/configSegments';

type SegmentReferenceHolder = {
  has: (segmentId: string) => boolean;
  remove: (segmentId: string) => void;
};

// An unparseable color is left out, so the segment keeps the color it has.
const fromConfigured = (name: string, configured: ConfiguredSegments[string]) =>
  cleanUndefined({
    name,
    color: configured.color ? tryCssColorToRGBA(configured.color) : undefined,
    fillOpacity: configured.fillOpacity,
    outlineOpacity: configured.outlineOpacity,
    strokeWidth: configured.strokeWidth,
  });

const configuredAppearance = ({
  color,
  fillOpacity,
  outlineOpacity,
  strokeWidth,
}: Segment) => ({ color, fillOpacity, outlineOpacity, strokeWidth });

/**
 * Identity and shared appearance for a family of segments: one instance backs
 * paint, rectangles, polygons and rulers together. Explicit order drives the
 * picker, shortcuts, serialization and export precedence.
 */
export const createSegmentRegistry = () => {
  // Stores holding masks or shapes declare them here; the registry knows neither.
  const referenceHolders = new Map<string, SegmentReferenceHolder>();
  const declareReferences = (name: string, holder: SegmentReferenceHolder) => {
    referenceHolders.set(name, holder);
  };
  const hasReferences = (segmentId: string) =>
    [...referenceHolders.values()].some((holder) => holder.has(segmentId));
  const removeReferences = (segmentId: string) =>
    referenceHolders.forEach((holder) => holder.remove(segmentId));

  const segmentById = ref<Record<string, Segment>>({}) as Ref<
    Record<string, Segment>
  >;

  const segmentOrder = ref<string[]>([]);
  const segmentList = computed(() =>
    segmentOrder.value.map((id) => segmentById.value[id])
  );

  /**
   * Trimmed name to the ids carrying it. Maintained as segments arrive, are
   * renamed and leave, so a name lookup and the uniqueness scans cost a probe
   * instead of a walk over every segment: an import mints one segment per
   * label, and a thousand-label labelmap is in scope.
   */
  const idsByName = new Map<string, string[]>();

  const indexName = (name: string, id: string) => {
    const key = name.trim();
    const ids = idsByName.get(key);
    if (ids) ids.push(id);
    else idsByName.set(key, [id]);
  };

  // Where the last search under a prefix ended. Every suffix below it is
  // taken until a name leaves, so a run of mints sharing a stem resumes there
  // and still lands on the lowest free suffix.
  const suffixFloors = new Map<string, number>();

  const unindexName = (name: string, id: string) => {
    const key = name.trim();
    const ids = idsByName.get(key);
    if (!ids) return;
    const at = ids.indexOf(id);
    if (at !== -1) ids.splice(at, 1);
    if (ids.length === 0) idsByName.delete(key);
    suffixFloors.clear();
  };

  const nameTaken = (name: string) => idsByName.has(name);

  const getSegment = (id: Maybe<string>) =>
    id ? segmentById.value[id] : undefined;

  const chosenSegmentId = ref<Maybe<string>>();
  const selectionRevision = ref(0);

  // Whenever segments exist one is selected, so every edit lands where the
  // highlighted row says: the user's choice while it exists, else the first.
  const selectedSegmentId = computed(
    () => (getSegment(chosenSegmentId.value) ?? segmentList.value[0])?.id
  );

  // Only a live segment can be chosen, so nothing clears a choice back to none.
  const selectSegment = (id: Maybe<string>) => {
    if (!getSegment(id)) return;
    chosenSegmentId.value = id;
    // Reselecting the same segment can still request that its row be revealed.
    selectionRevision.value += 1;
  };

  const appearanceOf = (id: Maybe<string>) =>
    resolveSegmentAppearance(getSegment(id));

  // Cached: the export sort asks twice per comparison.
  const orderIndex = computed(
    () => new Map(segmentOrder.value.map((id, index) => [id, index]))
  );

  const orderIndexOf = (id: string) => orderIndex.value.get(id) ?? -1;

  const findSegmentByName = (name: string) => {
    // The index keys on the trimmed name; the answer is still an exact match.
    const matches = (idsByName.get(name.trim()) ?? []).filter(
      (id) => segmentById.value[id]?.name === name
    );
    // Several segments carry the name: the first in registry order answers.
    const [first] = matches.sort((a, b) => orderIndexOf(a) - orderIndexOf(b));
    return getSegment(first);
  };

  // `family` keys the floor: every name `nameFor` gives belongs to it.
  const lowestFreeName = (
    family: string,
    nameFor: (index: number) => string,
    first: number
  ) => {
    let index = suffixFloors.get(family) ?? first;
    while (nameTaken(nameFor(index))) index += 1;
    suffixFloors.set(family, index);
    return nameFor(index);
  };

  // The name index and every lookup ignore surrounding space, so the stem has
  // to be trimmed as well.
  const uniqueName = (stem: string) => {
    const base = stem.trim();
    return nameTaken(base)
      ? lowestFreeName(`${base} (`, (index) => `${base} (${index})`, 2)
      : base;
  };

  // A stem family ends in ' (', so this key never collides with one.
  const defaultName = () =>
    lowestFreeName('default', makeDefaultSegmentName, 1);

  const nextToolColor = cycle(TOOL_COLORS);
  const nextColor = () => cssColorToRGBA(nextToolColor());

  /** Mints a segment without choosing it. Allocates no voxels. */
  const mintSegment = (init: SegmentInit = {}) => {
    const id = useIdStore().nextId();
    const stated = cleanUndefined(init);
    // Mutated in place: a copy per mint makes a large import quadratic.
    const segment = {
      name: stated.name ?? defaultName(),
      color: nextColor(),
      visible: true,
      locked: false,
      ...stated,
      id,
    };
    segmentById.value[id] = segment;
    segmentOrder.value.push(id);
    indexName(segment.name, id);
    return id;
  };

  const addSegment = (init: SegmentInit = {}) => {
    const id = mintSegment(init);
    selectSegment(id);
    return id;
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
    if (next.name !== segment.name) {
      unindexName(segment.name, id);
      indexName(next.name, id);
    }
    segmentById.value[id] = next;
  };

  // Deleting a referenced segment takes its masks and shapes with it; the
  // caller owns the confirmation.
  const deleteSegment = (id: string) => {
    const segment = segmentById.value[id];
    if (!segment) return;
    removeReferences(id);
    segmentOrder.value = segmentOrder.value.filter((key) => key !== id);
    unindexName(segment.name, id);
    delete segmentById.value[id];
  };

  const moveSegment = (id: string, target: string, after = false) => {
    if (id === target || !getSegment(id) || !getSegment(target)) return;
    const order = segmentOrder.value.filter((key) => key !== id);
    order.splice(order.indexOf(target) + Number(after), 0, id);
    segmentOrder.value = order;
  };

  // Mints without choosing: an automatic seat must not outrank a session's
  // restored selection, and the first-row fallback already selects it.
  const ensureSelectedSegment = () => selectedSegmentId.value ?? mintSegment();

  /**
   * Exact-name lookup, minting on a miss. Import binds descriptors this way,
   * so a file's segment lands on the one already carrying that name and the
   * registry's own color wins.
   */
  const segmentNamed = (name: string, init: SegmentInit = {}) => {
    const existing = findSegmentByName(name);
    if (existing) return existing.id;
    return mintSegment({ ...init, name });
  };

  // --- config overlay --- //

  // Keep each key's identity and appearance beneath its config contribution.
  // New segments begin with automatic color and default optional appearance;
  // a restored segment begins with its session appearance.
  type ConfigEntry = {
    id: string;
    appearance: ReturnType<typeof configuredAppearance>;
    contribution: ReturnType<typeof fromConfigured>;
    minted: boolean;
  };
  const configEntries = new Map<string, ConfigEntry>();

  const heldByConfig = (id: string) =>
    [...configEntries.values()].some((entry) => entry.id === id);

  const overlayConfig = (name: string, entry: ConfigEntry) => {
    configEntries.set(name, entry);
    updateSegment(entry.id, { ...entry.appearance, ...entry.contribution });
  };

  const seatConfigured = (name: string) => {
    const matched = findSegmentByName(name)?.id;
    const id = matched ?? mintSegment({ name });
    return {
      id,
      appearance: configuredAppearance(getSegment(id)!),
      minted: !matched,
    };
  };

  const replaceConfigSegments = (configured: Maybe<ConfiguredSegments>) => {
    const next = configured ?? {};

    Object.entries(next).forEach(([name, props]) => {
      const held = configEntries.get(name);
      overlayConfig(name, {
        ...(held && getSegment(held.id) ? held : seatConfigured(name)),
        contribution: fromConfigured(name, props),
      });
    });

    [...configEntries.entries()]
      .filter(([name]) => !Object.hasOwn(next, name))
      .forEach(([name, { id, minted }]) => {
        configEntries.delete(name);
        // Content keeps its last configured appearance; a segment the config
        // matched by name rather than minted is not the config's to drop.
        if (minted && segmentById.value[id] && !hasReferences(id))
          deleteSegment(id);
      });
  };

  // --- wire --- //

  const serialize = () => segmentList.value.map((segment) => ({ ...segment }));

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
    const held = [...configEntries].find(([, entry]) => entry.id === id);
    // Now the session's segment as well, so dropping the key must not take it.
    if (held)
      overlayConfig(held[0], {
        ...held[1],
        appearance: configuredAppearance(getSegment(id)!),
        minted: false,
      });
    return id;
  };

  /**
   * Seats restored segments and returns the idMap every incoming reference is
   * remapped through. An incoming segment joins the first existing segment of
   * its name when that one holds no mask or shape on any image, restoring its
   * own appearance onto it; otherwise it is minted under a unique name, so
   * content already here keeps its segment. `repeated` lists the entries left
   * unseated because an earlier one claimed their id.
   */
  const adopt = (incoming: Maybe<Segment[]>) => {
    // Prototype-free: a file's ids are its own, so an id spelling an
    // Object.prototype key ('constructor', 'toString') must not read as
    // already seen here, nor hand a caller an inherited member in place of a
    // miss when it looks the id up in the returned map.
    const idMap: Record<string, string> = Object.create(null);
    const repeated: Segment[] = [];
    // Seated by this call, so no later entry of the same name can join it.
    const seated = new Set<string>();
    const reusable = (name: string) => {
      const existing = findSegmentByName(name)?.id;
      return existing && !seated.has(existing) && !hasReferences(existing)
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
        : mintSegment({ ...init, name: uniqueName(init.name) });
      seated.add(target);
      idMap[id] = target;
    });
    return { idMap, repeated };
  };

  /** Selects a restored segment unless the user already chose one. */
  const restoreSelection = (id: Maybe<string>) => {
    if (!getSegment(chosenSegmentId.value)) selectSegment(id);
  };

  return {
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
    moveSegment,
    deleteSegment,
    ensureSelectedSegment,
    segmentNamed,
    replaceConfigSegments,
    heldByConfig,
    serialize,
    adopt,
    declareReferences,
  };
};

export type SegmentRegistry = ReturnType<typeof createSegmentRegistry>;
