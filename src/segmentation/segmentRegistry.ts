import { computed, ref, type Ref } from 'vue';

import { TOOL_COLORS } from '@/src/config';
import { useIdStore } from '@/src/store/id';
import type { Maybe } from '@/src/types';
import { cssColorToRGBA } from '@/src/segmentation/color';
import {
  resolveSegmentAppearance,
  type Segment,
  type SegmentInit,
} from '@/src/segmentation/segment';
import { omit } from '@/src/utils';
import { cleanUndefined } from '@/src/utils';

export type ConfiguredSegment = {
  color?: string;
  fillOpacity?: number;
  outlineOpacity?: number;
  strokeWidth?: number;
};

export type ConfiguredSegments = Record<string, ConfiguredSegment>;

export type SegmentRegistryOptions = {
  hasReferences?: (segmentId: string) => boolean;
  removeReferences?: (segmentId: string) => void;
};

const fromConfigured = (
  name: string,
  configured: ConfiguredSegment
): SegmentInit =>
  cleanUndefined({
    name,
    color: configured.color ? cssColorToRGBA(configured.color) : undefined,
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
export const createSegmentRegistry = ({
  hasReferences = () => false,
  removeReferences = () => {},
}: SegmentRegistryOptions = {}) => {
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

  const selectedSegmentId = ref<Maybe<string>>();
  const selectionRevision = ref(0);

  // A type that is gone is not selected.
  const selectedSegment = computed(() =>
    selectedSegmentId.value
      ? segmentById.value[selectedSegmentId.value]
      : undefined
  );

  const selectSegment = (id: Maybe<string>) => {
    selectedSegmentId.value = id && segmentById.value[id] ? id : undefined;
    // Reselecting the same segment can still request that its row be revealed.
    if (selectedSegmentId.value) selectionRevision.value += 1;
  };

  const getSegment = (id: Maybe<string>) =>
    id ? segmentById.value[id] : undefined;

  const appearanceOf = (id: Maybe<string>) =>
    resolveSegmentAppearance(getSegment(id));

  // Cached: the renderer asks for one index per mask per re-render, and the
  // export sort asks twice per comparison.
  const orderIndex = computed(
    () => new Map(segmentOrder.value.map((id, index) => [id, index]))
  );

  const orderIndexOf = (id: Maybe<string>) =>
    (id === undefined || id === null ? undefined : orderIndex.value.get(id)) ??
    -1;

  const findSegmentByName = (name: Maybe<string>) => {
    if (name === undefined || name === null) return undefined;
    const candidates = idsByName.get(name.trim()) ?? [];
    // The index keys on the trimmed name; the answer is still an exact match.
    const matches = candidates.filter(
      (id) => segmentById.value[id]?.name === name
    );
    if (matches.length <= 1) return getSegment(matches[0]);
    // Several segments carry the name: the first in registry order answers.
    return segmentList.value.find((type) => matches.includes(type.id));
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

  let nextColorIndex = 0;
  const nextColor = () => {
    const color = cssColorToRGBA(TOOL_COLORS[nextColorIndex]);
    nextColorIndex = (nextColorIndex + 1) % TOOL_COLORS.length;
    return color;
  };

  /** Mints a segment without touching the selection. Allocates no voxels. */
  const mintSegment = (init: SegmentInit = {}) => {
    const id = useIdStore().nextId();
    const stated = cleanUndefined(init);
    // Mutated in place, and the default name is searched for only when the
    // caller states none: copying the record and the order per mint made an
    // import quadratic in its label count.
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
    const type = segmentById.value[id];
    if (!type) return;
    const next = { ...type, ...patch, id };
    if (next.name !== type.name) {
      unindexName(type.name, id);
      indexName(next.name, id);
    }
    segmentById.value[id] = next;
  };

  // Deleting a referenced segment takes its masks and shapes with it; the
  // caller owns the confirmation.
  const deleteSegment = (id: string) => {
    const type = segmentById.value[id];
    if (!type) return;
    removeReferences(id);
    segmentOrder.value = segmentOrder.value.filter((key) => key !== id);
    unindexName(type.name, id);
    segmentById.value = omit(segmentById.value, id);
    if (selectedSegmentId.value === id) {
      selectSegment(segmentOrder.value[0]);
    }
  };

  const moveSegment = (id: string, target: string, after = false) => {
    if (id === target || !getSegment(id) || !getSegment(target)) return;
    const order = segmentOrder.value.filter((key) => key !== id);
    order.splice(order.indexOf(target) + Number(after), 0, id);
    segmentOrder.value = order;
  };

  /**
   * Where `ensureSelectedSegment` would land, selecting and minting nothing.
   * An empty registry has no answer, and what would be minted there is a fresh
   * segment carrying the defaults.
   */
  const presumedSegmentId = () =>
    selectedSegment.value?.id ?? segmentList.value[0]?.id;

  const ensureSelectedSegment = () => {
    if (selectedSegment.value) return selectedSegment.value.id;
    const first = segmentList.value[0];
    if (!first) return addSegment();
    selectSegment(first.id);
    return first.id;
  };

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
    { id: string; appearance: ReturnType<typeof configuredAppearance> }
  >();

  const replaceConfigSegments = (configured: Maybe<ConfiguredSegments>) => {
    const next = configured ?? {};

    Object.entries(next).forEach(([name, props]) => {
      let entry = configEntries.get(name);
      if (!entry || !getSegment(entry.id)) {
        const id = findSegmentByName(name)?.id ?? mintSegment({ name });
        entry = { id, appearance: configuredAppearance(getSegment(id)!) };
      }
      updateSegment(entry.id, {
        ...entry.appearance,
        ...fromConfigured(name, props),
      });
      configEntries.set(name, entry);
    });

    [...configEntries.entries()]
      .filter(([name]) => !Object.hasOwn(next, name))
      .forEach(([name, { id }]) => {
        configEntries.delete(name);
        // Content keeps the last configured appearance as session state.
        if (segmentById.value[id] && !hasReferences(id)) deleteSegment(id);
      });

    // A configured registry offers a selection from the start; selecting
    // creates nothing, so the first edit lands in a configured type rather
    // than minting one beside it.
    if (!selectedSegment.value) selectSegment(segmentList.value[0]?.id);
  };

  // --- wire --- //

  const serialize = () => segmentList.value.map((type) => ({ ...type }));

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

  return {
    segmentById,
    segmentList,
    selectedSegmentId,
    selectionRevision,
    selectedSegment,
    selectSegment,
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
    presumedSegmentId,
    ensureSelectedSegment,
    segmentNamed,
    replaceConfigSegments,
    serialize,
    adopt,
  };
};

export type SegmentRegistry = ReturnType<typeof createSegmentRegistry>;
