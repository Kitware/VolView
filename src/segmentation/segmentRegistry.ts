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

/** A segment as a config file states it: css color, appearance all optional. */
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
    while (taken.has(`Segment ${index}`)) index += 1;
    return `Segment ${index}`;
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
        ...cleanUndefined(init),
        id,
      },
    };
    segmentOrder.value = [...segmentOrder.value, id];
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
    segmentOrder.value = segmentOrder.value.filter((key) => key !== id);
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

  /** Reuse the selection or first segment, minting only for an empty registry. */
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
      .filter(([name]) => !(name in next))
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
    ensureSelectedSegment,
    segmentNamed,
    replaceConfigSegments,
    serialize,
    adopt,
  };
};

export type SegmentRegistry = ReturnType<typeof createSegmentRegistry>;
