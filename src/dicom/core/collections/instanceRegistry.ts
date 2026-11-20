import type { Instance } from '../instance/readInstance';
import { trimDicomPadding } from '../utils';
import { getDatasetTag } from '../metadata/datasetAccess';
import { Tags } from '../metadata/dicomTags';
import {
  planDicomCollections,
  type DicomCollection,
  type InstanceFacts,
} from './planDicomCollections';
import { assignIds, type CommittedCollection } from './assignCollectionIds';
import { seriesKeyOf } from './instanceFacts';
import { readDatasetDetails } from './datasetDetails';
import { groupBy } from './groupBy';
import type { Reconstruction } from './reconstructVolume';

export type InstanceCollectionUpdate = {
  id: string;
  collection: DicomCollection;
  /** Registered instances in the collection's order, aligned with collection.members. */
  members: Instance[];
  /** Aligned with members: the batch's own instance wherever it re-supplied one. */
  provenance: Instance[];
  /** Same members and geometry as last committed under this ID, so its volume stands. */
  unchanged: boolean;
};

// An instance with no SOP Instance UID is identified by its object, so two of
// them never merge while re-registering one does not duplicate it.
type InstanceKey = string | Instance;

type Registered = {
  key: InstanceKey;
  instance: Instance;
  facts: InstanceFacts;
};

type Committed = {
  members: readonly InstanceKey[];
  orientation: readonly number[] | null;
  reconstruction: Reconstruction;
  // Siblings can change either without moving a member, and that is reported.
  label: string | null;
  warnings: readonly string[];
};

type SeriesState = {
  instances: ReadonlyMap<InstanceKey, Registered>;
  committed: ReadonlyMap<string, Committed>;
};

/** Every instance seen so far and the collections last planned, per series. */
export type RegistryState = ReadonlyMap<string, SeriesState>;

export const emptyRegistry: RegistryState = new Map();

const emptySeries: SeriesState = { instances: new Map(), committed: new Map() };

const keyOf = (instance: Instance) =>
  trimDicomPadding(
    getDatasetTag(instance.dataset, Tags.SOPInstanceUID) ?? ''
  ) || instance;

// A facts object of its own: the planner's members are matched back by identity.
const registeredOf = (instance: Instance) => ({
  key: keyOf(instance),
  instance,
  facts: { ...readDatasetDetails(instance.dataset).facts },
});

// A collection holding no SOP Instance UID cannot be claimed back by overlap,
// so its ID is re-minted from its key instead of counting as taken.
const claimable = (committed: SeriesState['committed']) =>
  [...committed]
    .map(
      ([id, { members }]): CommittedCollection => ({
        id,
        sopInstanceUids: members.filter(
          (key): key is string => typeof key === 'string'
        ),
      })
    )
    .filter((collection) => collection.sopInstanceUids.length > 0);

const sameList = <T>(a: readonly T[] | null, b: readonly T[] | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.length === b.length &&
    a.every((value, index) => value === b[index]));

const reasonOf = (reconstruction: Reconstruction) =>
  reconstruction.kind === 'irregular' ? reconstruction.reason : null;

const sameReconstruction = (a: Reconstruction, b: Reconstruction) =>
  a.kind === b.kind &&
  reasonOf(a) === reasonOf(b) &&
  a.sliceSpacing === b.sliceSpacing;

const sameVolume = (before: Committed, after: Committed) =>
  sameList(before.members, after.members) &&
  sameList(before.orientation, after.orientation) &&
  sameReconstruction(before.reconstruction, after.reconstruction);

const sameDescription = (before: Committed | undefined, after: Committed) =>
  !before ||
  (before.label === after.label && sameList(before.warnings, after.warnings));

// The first registration of an instance wins; a re-supply only reports back.
function mergeBatch(series: SeriesState, batch: Registered[]) {
  const instances = new Map(series.instances);
  const conflicting = new Set<string>();
  batch.forEach((entry) => {
    const existing = instances.get(entry.key);
    if (!existing) instances.set(entry.key, entry);
    else if (
      typeof entry.key === 'string' &&
      JSON.stringify(existing.facts) !== JSON.stringify(entry.facts)
    )
      conflicting.add(entry.key);
  });
  return { instances, conflicting };
}

const firstByKey = (batch: Registered[]) =>
  batch.reduce(
    (byKey, entry) =>
      byKey.has(entry.key) ? byKey : byKey.set(entry.key, entry.instance),
    new Map<InstanceKey, Instance>()
  );

function planSeries(
  series: SeriesState,
  seriesKey: string,
  batch: Registered[]
) {
  const { instances, conflicting } = mergeBatch(series, batch);
  const registered = [...instances.values()];
  const plan = planDicomCollections({
    seriesKey,
    instances: registered.map((entry) => entry.facts),
  });
  const assigned = assignIds(plan, claimable(series.committed));
  const entryOf = new Map(registered.map((entry) => [entry.facts, entry]));
  const supplied = firstByKey(batch);
  const provenanceOf = ({ key, instance }: Registered) =>
    typeof key === 'string' && conflicting.has(key)
      ? instance
      : (supplied.get(key) ?? instance);

  const planned = assigned.map(({ id, ...collection }) => {
    const entries = collection.members.map((facts) => entryOf.get(facts)!);
    const committed: Committed = {
      members: entries.map((entry) => entry.key),
      orientation: collection.orientation,
      reconstruction: collection.reconstruction,
      label: collection.label,
      warnings: collection.warnings,
    };
    const members = entries.map((entry) => entry.instance);
    const previous = series.committed.get(id);
    const unchanged = !!previous && sameVolume(previous, committed);
    const update: InstanceCollectionUpdate = {
      id,
      collection,
      members,
      provenance: entries.map(provenanceOf),
      unchanged,
    };
    // A replan can move members or relabel a collection the batch brought nothing.
    const changed =
      !unchanged ||
      !sameDescription(previous, committed) ||
      committed.members.some((key) => supplied.has(key));
    return { committed, update, changed };
  });

  return {
    series: {
      instances,
      committed: new Map(
        planned.map(({ update, committed }) => [update.id, committed])
      ),
    },
    updates: planned
      .filter(({ changed }) => changed)
      .map(({ update }) => update),
    removed: [...series.committed.keys()].filter(
      (id) => !planned.some(({ update }) => update.id === id)
    ),
    conflictingInstanceUids: [...conflicting],
  };
}

/**
 * Registers a batch and replans every series it touches. Pure: the caller
 * keeps the returned state, so abandoning an import is not assigning it.
 */
export function registerInstances(
  state: RegistryState,
  batch: readonly Instance[]
) {
  const bySeries = groupBy([...batch], (instance) =>
    seriesKeyOf(instance.dataset)
  );
  const results = [...bySeries].map(([seriesKey, instances]) => ({
    seriesKey,
    ...planSeries(
      state.get(seriesKey) ?? emptySeries,
      seriesKey,
      instances.map(registeredOf)
    ),
  }));
  const next = new Map(state);
  results.forEach(({ seriesKey, series }) => next.set(seriesKey, series));
  return {
    state: next as RegistryState,
    updates: results.flatMap((result) => result.updates),
    /** Committed IDs the replan dissolved, whose members moved elsewhere. */
    removed: results.flatMap((result) => result.removed),
    /** Different header facts under a registered SOP Instance UID; the first copy is kept. */
    conflictingInstanceUids: results.flatMap(
      (result) => result.conflictingInstanceUids
    ),
  };
}

function forgetFromSeries(series: SeriesState, collectionId: string) {
  const forgotten = series.committed.get(collectionId);
  if (!forgotten) return series;
  const instances = new Map(series.instances);
  forgotten.members.forEach((key) => instances.delete(key));
  const committed = new Map(series.committed);
  committed.delete(collectionId);
  return { instances, committed };
}

/** Drops a collection and the instances it held, so a re-import plans them afresh. */
export function forgetCollection(
  state: RegistryState,
  collectionId: string
): RegistryState {
  const owner = [...state].find(([, series]) =>
    series.committed.has(collectionId)
  );
  if (!owner) return state;
  const [seriesKey, series] = owner;
  const next = new Map(state);
  const remaining = forgetFromSeries(series, collectionId);
  if (remaining.instances.size === 0) next.delete(seriesKey);
  else next.set(seriesKey, remaining);
  return next;
}
