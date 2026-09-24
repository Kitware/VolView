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
 * picker, shortcuts, serialization and labelmap stacking.
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

  // Cached: the renderer asks for one index per mask per re-render, and the
  // export sort asks twice per comparison.
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

  const lowestFreeName = (prefix: string, tail: string, first: number) => {
    let index = suffixFloors.get(prefix) ?? first;
    while (nameTaken(`${prefix}${index}${tail}`)) index += 1;
    suffixFloors.set(prefix, index);
    return `${prefix}${index}${tail}`;
  };

  // The name index and every lookup ignore surrounding space, so the stem has
  // to be trimmed as well.
  const uniqueName = (stem: string) => {
    const base = stem.trim();
    return nameTaken(base) ? lowestFreeName(`${base} (`, ')', 2) : base;
  };

  const defaultName = () => lowestFreeName('Segment ', '', 1);

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

  const ensureSelectedSegment = () => selectedSegmentId.value ?? addSegment();

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
  const configEntries = new Map<
    string,
    {
      id: string;
      appearance: ReturnType<typeof configuredAppearance>;
      minted: boolean;
    }
  >();

  const replaceConfigSegments = (configured: Maybe<ConfiguredSegments>) => {
    const next = configured ?? {};

    Object.entries(next).forEach(([name, props]) => {
      let entry = configEntries.get(name);
      if (!entry || !getSegment(entry.id)) {
        const matched = findSegmentByName(name)?.id;
        const id = matched ?? mintSegment({ name });
        entry = {
          id,
          appearance: configuredAppearance(getSegment(id)!),
          minted: !matched,
        };
      }
      updateSegment(entry.id, {
        ...entry.appearance,
        ...fromConfigured(name, props),
      });
      configEntries.set(name, entry);
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

  /**
   * Seats restored segments beside the ones already here. Ids are minted fresh
   * and every incoming reference is remapped through the returned map, so an
   * import into a populated scene overwrites nothing.
   */
  const adopt = (incoming: Maybe<Segment[]>) => {
    // Prototype-free: a file's ids are its own, so an id spelling an
    // Object.prototype key ('constructor', 'toString') must not read as
    // already seen here, nor hand a caller an inherited member in place of a
    // miss when it looks the id up in the returned map.
    const idMap: Record<string, string> = Object.create(null);
    (incoming ?? []).forEach(({ id, ...init }) => {
      // Nothing makes a file's ids unique, and only one segment can answer for
      // an id. The first entry wins; minting the rest as well would leave
      // segments in the sidebar that no mask or shape can ever reference.
      if (Object.hasOwn(idMap, id)) return;
      idMap[id] = mintSegment(init as SegmentInit);
    });
    return idMap;
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
    serialize,
    adopt,
    declareReferences,
  };
};

export type SegmentRegistry = ReturnType<typeof createSegmentRegistry>;
