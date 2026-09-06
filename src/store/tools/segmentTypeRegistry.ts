import { computed, ref, type Ref } from 'vue';

import { TOOL_COLORS } from '@/src/config';
import { useIdStore } from '@/src/store/id';
import type { Maybe } from '@/src/types';
import { cssColorToRGBA } from '@/src/types/segmentation';
import {
  resolveSegmentType,
  type SegmentType,
  type SegmentTypeInit,
} from '@/src/types/segmentType';
import { omit } from '@/src/utils';

/** A type as a config file states it: css color, appearance all optional. */
export type ConfiguredSegmentType = {
  color?: string;
  fillOpacity?: number;
  outlineOpacity?: number;
  strokeWidth?: number;
};

export type ConfiguredSegmentTypes = Record<string, ConfiguredSegmentType>;

export type SegmentTypeRegistryOptions = {
  /** Stem of the name a minted type gets: `${namePrefix} 1`. */
  namePrefix?: string;
  /** Seeded through the config path, so a real config replaces them. */
  defaults?: ConfiguredSegmentTypes;
  hasReferences?: (typeId: string) => boolean;
  removeReferences?: (typeId: string) => void;
};

const withoutUndefined = (init: SegmentTypeInit) =>
  Object.fromEntries(
    Object.entries(init).filter(([, value]) => value !== undefined)
  ) as SegmentTypeInit;

const fromConfigured = (
  name: string,
  configured: ConfiguredSegmentType
): SegmentTypeInit =>
  withoutUndefined({
    name,
    color: configured.color ? cssColorToRGBA(configured.color) : undefined,
    fillOpacity: configured.fillOpacity,
    outlineOpacity: configured.outlineOpacity,
    strokeWidth: configured.strokeWidth,
  });

/**
 * Identity and shared appearance for one family of types: one instance backs
 * paint, rectangles and polygons together, another backs rulers. Key order is
 * creation order, which is the order the picker lists and the labelmap
 * renderer offsets by, so no separate order list exists.
 */
export const createSegmentTypeRegistry = ({
  namePrefix = 'Segment',
  defaults,
  hasReferences = () => false,
  removeReferences = () => {},
}: SegmentTypeRegistryOptions = {}) => {
  const typeById = ref<Record<string, SegmentType>>({}) as Ref<
    Record<string, SegmentType>
  >;

  const typeList = computed(() => Object.values(typeById.value));

  const selectedTypeId = ref<Maybe<string>>();

  // A type that is gone is not selected.
  const selectedType = computed(() =>
    selectedTypeId.value ? typeById.value[selectedTypeId.value] : undefined
  );

  const selectType = (id: Maybe<string>) => {
    selectedTypeId.value = id && typeById.value[id] ? id : undefined;
  };

  const getType = (id: Maybe<string>) => (id ? typeById.value[id] : undefined);

  const appearanceOf = (id: Maybe<string>) => resolveSegmentType(getType(id));

  const orderIndexOf = (id: Maybe<string>) =>
    id ? Object.keys(typeById.value).indexOf(id) : -1;

  const findTypeByName = (name: Maybe<string>) =>
    typeList.value.find((type) => type.name === name);

  const uniqueName = (stem: string) => {
    const taken = new Set(typeList.value.map((type) => type.name.trim()));
    if (!taken.has(stem)) return stem;
    let index = 2;
    while (taken.has(`${stem} (${index})`)) index += 1;
    return `${stem} (${index})`;
  };

  const defaultName = () => {
    const taken = new Set(typeList.value.map((type) => type.name.trim()));
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

  /** Mints a type without touching the selection. Allocates no voxels. */
  const mintType = (init: SegmentTypeInit = {}) => {
    const id = useIdStore().nextId();
    typeById.value = {
      ...typeById.value,
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

  const addType = (init: SegmentTypeInit = {}) => {
    const id = mintType(init);
    selectType(id);
    return id;
  };

  const updateType = (id: string, patch: SegmentTypeInit) => {
    const type = typeById.value[id];
    if (!type) return;
    typeById.value = { ...typeById.value, [id]: { ...type, ...patch, id } };
  };

  // Deleting a referenced type takes its masks and shapes with it; the caller
  // owns the confirmation.
  const deleteType = (id: string) => {
    if (!typeById.value[id]) return;
    removeReferences(id);
    typeById.value = omit(typeById.value, id);
    if (selectedTypeId.value === id) {
      selectType(Object.keys(typeById.value)[0]);
    }
  };

  /** The selected type, minting one when nothing is selected yet. */
  const ensureSelectedType = () => {
    if (selectedType.value) return selectedType.value.id;
    return addType();
  };

  /**
   * Exact-name lookup, minting on a miss. Import binds descriptors this way,
   * so a file's segment lands on the type already carrying that name and the
   * registry's own color wins.
   */
  const typeNamed = (name: string, init: SegmentTypeInit = {}) => {
    const existing = findTypeByName(name);
    if (existing) return existing.id;
    return mintType({ ...init, name });
  };

  // --- config overlay --- //

  // Config entries are keyed by name; the id a key resolved to is remembered
  // so the same key keeps its id across config changes.
  const configIds = new Map<string, string>();

  const replaceConfigTypes = (configured: Maybe<ConfiguredSegmentTypes>) => {
    const next = configured ?? {};

    Object.entries(next).forEach(([name, props]) => {
      const existing = configIds.get(name);
      const id =
        existing && typeById.value[existing]
          ? existing
          : (findTypeByName(name)?.id ?? mintType(fromConfigured(name, props)));
      updateType(id, fromConfigured(name, props));
      configIds.set(name, id);
    });

    [...configIds.entries()]
      .filter(([name]) => !(name in next))
      .forEach(([name, id]) => {
        configIds.delete(name);
        // Content still points at it, so it survives as a session type.
        if (typeById.value[id] && !hasReferences(id)) deleteType(id);
      });

    // A configured registry offers a selection from the start; selecting
    // creates nothing, so the first edit lands in a configured type rather
    // than minting one beside it.
    if (!selectedType.value) selectType(typeList.value[0]?.id);
  };

  replaceConfigTypes(defaults);

  // --- wire --- //

  const serialize = () => typeList.value.map((type) => ({ ...type }));

  /**
   * Seats restored types beside the ones already here. Ids are minted fresh
   * and every incoming reference is remapped through the returned map, so an
   * import into a populated scene overwrites nothing.
   */
  const adopt = (incoming: Maybe<SegmentType[]>) =>
    Object.fromEntries(
      (incoming ?? []).map(({ id, ...init }) => [
        id,
        mintType(init as SegmentTypeInit), // side effect in Array.map
      ])
    );

  return {
    typeById,
    typeList,
    selectedTypeId,
    selectedType,
    selectType,
    getType,
    appearanceOf,
    orderIndexOf,
    findTypeByName,
    uniqueName,
    mintType,
    addType,
    updateType,
    deleteType,
    ensureSelectedType,
    typeNamed,
    replaceConfigTypes,
    serialize,
    adopt,
  };
};

export type SegmentTypeRegistry = ReturnType<typeof createSegmentTypeRegistry>;
