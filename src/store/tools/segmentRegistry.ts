import { computed, ref, type Ref } from 'vue';

import { TOOL_COLORS } from '@/src/config';
import { useIdStore } from '@/src/store/id';
import type { Maybe } from '@/src/types';
import { cssColorToRGBA } from '@/src/types/segmentation';
import {
  resolveSegmentAppearance,
  type Segment,
  type SegmentInit,
} from '@/src/types/segment';
import { omit } from '@/src/utils';

/** A segment as a config file states it: css color, appearance all optional. */
export type ConfiguredSegment = {
  color?: string;
  fillOpacity?: number;
  outlineOpacity?: number;
  strokeWidth?: number;
};

export type ConfiguredSegments = Record<string, ConfiguredSegment>;

export type SegmentRegistryOptions = {
  /** Stem of the name a minted segment gets: `${namePrefix} 1`. */
  namePrefix?: string;
  /** Seeded through the config path, so a real config replaces them. */
  defaults?: ConfiguredSegments;
  hasReferences?: (segmentId: string) => boolean;
  removeReferences?: (segmentId: string) => void;
};

const withoutUndefined = (init: SegmentInit) =>
  Object.fromEntries(
    Object.entries(init).filter(([, value]) => value !== undefined)
  ) as SegmentInit;

const fromConfigured = (
  name: string,
  configured: ConfiguredSegment
): SegmentInit =>
  withoutUndefined({
    name,
    color: configured.color ? cssColorToRGBA(configured.color) : undefined,
    fillOpacity: configured.fillOpacity,
    outlineOpacity: configured.outlineOpacity,
    strokeWidth: configured.strokeWidth,
  });

/**
 * Identity and shared appearance for one family of segments: one instance backs
 * paint, rectangles and polygons together, another backs rulers. Key order is
 * creation order, which is the order the picker lists and the labelmap
 * renderer offsets by, so no separate order list exists.
 */
export const createSegmentRegistry = ({
  namePrefix = 'Segment',
  defaults,
  hasReferences = () => false,
  removeReferences = () => {},
}: SegmentRegistryOptions = {}) => {
  const segmentById = ref<Record<string, Segment>>({}) as Ref<
    Record<string, Segment>
  >;

  const segmentList = computed(() => Object.values(segmentById.value));

  const selectedSegmentId = ref<Maybe<string>>();

  // A type that is gone is not selected.
  const selectedSegment = computed(() =>
    selectedSegmentId.value
      ? segmentById.value[selectedSegmentId.value]
      : undefined
  );

  const selectSegment = (id: Maybe<string>) => {
    selectedSegmentId.value = id && segmentById.value[id] ? id : undefined;
  };

  const getSegment = (id: Maybe<string>) =>
    id ? segmentById.value[id] : undefined;

  const appearanceOf = (id: Maybe<string>) =>
    resolveSegmentAppearance(getSegment(id));

  const orderIndexOf = (id: Maybe<string>) =>
    id ? Object.keys(segmentById.value).indexOf(id) : -1;

  const findSegmentByName = (name: Maybe<string>) =>
    segmentList.value.find((type) => type.name === name);

  const uniqueName = (stem: string) => {
    const taken = new Set(segmentList.value.map((type) => type.name.trim()));
    if (!taken.has(stem)) return stem;
    let index = 2;
    while (taken.has(`${stem} (${index})`)) index += 1;
    return `${stem} (${index})`;
  };

  const defaultName = () => {
    const taken = new Set(segmentList.value.map((type) => type.name.trim()));
    let index = 1;
    while (taken.has(`${namePrefix} ${index}`)) index += 1;
    return `${namePrefix} ${index}`;
  };

  let nextColorIndex = 0;
  const nextColor = () => {
    const color = cssColorToRGBA(TOOL_COLORS[nextColorIndex]);
    nextColorIndex = (nextColorIndex + 1) % TOOL_COLORS.length;
    return color;
  };

  /** Mints a segment without touching the selection. Allocates no voxels. */
  const mintSegment = (init: SegmentInit = {}) => {
    const id = useIdStore().nextId();
    segmentById.value = {
      ...segmentById.value,
      [id]: {
        name: defaultName(),
        color: nextColor(),
        visible: true,
        locked: false,
        ...withoutUndefined(init),
        id,
      },
    };
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
    segmentById.value = {
      ...segmentById.value,
      [id]: { ...type, ...patch, id },
    };
  };

  // Deleting a referenced segment takes its masks and shapes with it; the
  // caller owns the confirmation.
  const deleteSegment = (id: string) => {
    if (!segmentById.value[id]) return;
    removeReferences(id);
    segmentById.value = omit(segmentById.value, id);
    if (selectedSegmentId.value === id) {
      selectSegment(Object.keys(segmentById.value)[0]);
    }
  };

  /** The selected segment, minting one when nothing is selected yet. */
  const ensureSelectedSegment = () => {
    if (selectedSegment.value) return selectedSegment.value.id;
    return addSegment();
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

  // Config entries are keyed by name; the id a key resolved to is remembered
  // so the same key keeps its id across config changes.
  const configIds = new Map<string, string>();

  const replaceConfigSegments = (configured: Maybe<ConfiguredSegments>) => {
    const next = configured ?? {};

    Object.entries(next).forEach(([name, props]) => {
      const existing = configIds.get(name);
      const id =
        existing && segmentById.value[existing]
          ? existing
          : (findSegmentByName(name)?.id ??
            mintSegment(fromConfigured(name, props)));
      updateSegment(id, fromConfigured(name, props));
      configIds.set(name, id);
    });

    [...configIds.entries()]
      .filter(([name]) => !(name in next))
      .forEach(([name, id]) => {
        configIds.delete(name);
        // Content still points at it, so it survives as a session segment.
        if (segmentById.value[id] && !hasReferences(id)) deleteSegment(id);
      });

    // A configured registry offers a selection from the start; selecting
    // creates nothing, so the first edit lands in a configured type rather
    // than minting one beside it.
    if (!selectedSegment.value) selectSegment(segmentList.value[0]?.id);
  };

  replaceConfigSegments(defaults);

  // --- wire --- //

  const serialize = () => segmentList.value.map((type) => ({ ...type }));

  /**
   * Seats restored segments beside the ones already here. Ids are minted fresh
   * and every incoming reference is remapped through the returned map, so an
   * import into a populated scene overwrites nothing.
   */
  const adopt = (incoming: Maybe<Segment[]>) =>
    Object.fromEntries(
      (incoming ?? []).map(({ id, ...init }) => [
        id,
        mintSegment(init as SegmentInit), // side effect in Array.map
      ])
    );

  return {
    segmentById,
    segmentList,
    selectedSegmentId,
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
    deleteSegment,
    ensureSelectedSegment,
    segmentNamed,
    replaceConfigSegments,
    serialize,
    adopt,
  };
};

export type SegmentRegistry = ReturnType<typeof createSegmentRegistry>;
