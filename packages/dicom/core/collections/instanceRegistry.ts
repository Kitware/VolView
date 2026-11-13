import type { Instance } from '../instance/readInstance';
import { trimDicomPadding } from '../utils';
import { getDatasetTag } from '../metadata/datasetAccess';
import { Tags } from '../metadata/dicomTags';
import {
  planDicomCollections,
  type DicomCollection,
  type InstanceFacts,
} from './planDicomCollections';
import {
  assignIds,
  encodeCollectionKey,
  type CommittedCollection,
} from './assignCollectionIds';
import { seriesKeyOf } from './instanceFacts';
import { readDatasetDetails } from './datasetDetails';
import { groupBy } from './groupBy';

export type InstanceCollectionUpdate = {
  id: string;
  seriesKey: string;
  collection: DicomCollection;
  /** Registered instances in the collection's order, aligned with collection.members. */
  members: Instance[];
  /** Aligned with members: the batch's own instance wherever it re-supplied one. */
  provenance: Instance[];
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
  // Reported when relabelled even if its members did not move.
  key: string;
};

type SeriesState = {
  instances: ReadonlyMap<InstanceKey, Registered>;
  committed: ReadonlyMap<string, Committed>;
};

/** Every instance seen so far and the collections last planned, per series. */
export type RegistryState = ReadonlyMap<string, SeriesState>;

export const emptyRegistry: RegistryState = new Map();

const emptySeries: SeriesState = { instances: new Map(), committed: new Map() };

// One facts object per instance: the planner's members are matched back by identity.
const factsByInstance = new WeakMap<Instance, InstanceFacts>();

const factsOf = (instance: Instance) => {
  const cached = factsByInstance.get(instance);
  if (cached) return cached;
  const facts = { ...readDatasetDetails(instance.dataset).facts };
  factsByInstance.set(instance, facts);
  return facts;
};

const keyOf = (instance: Instance): InstanceKey =>
  trimDicomPadding(
    getDatasetTag(instance.dataset, Tags.SOPInstanceUID) ?? ''
  ) || instance;

const registeredOf = (instance: Instance): Registered => ({
  key: keyOf(instance),
  instance,
  facts: factsOf(instance),
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

const unchanged = (before: Committed | undefined, after: Committed) =>
  before !== undefined &&
  before.key === after.key &&
  before.members.length === after.members.length &&
  before.members.every((key, index) => key === after.members[index]);

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

  const planned = assigned.collections.map(({ id, ...collection }) => {
    const entries = collection.members.map((facts) => entryOf.get(facts)!);
    const committed: Committed = {
      members: entries.map((entry) => entry.key),
      key: encodeCollectionKey(collection.key),
    };
    const update: InstanceCollectionUpdate = {
      id,
      seriesKey,
      collection,
      members: entries.map((entry) => entry.instance),
      provenance: entries.map(provenanceOf),
    };
    // A replan can move members or relabel a collection the batch brought nothing.
    const changed =
      committed.members.some((key) => supplied.has(key)) ||
      !unchanged(series.committed.get(id), committed);
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
    /** Different geometry under a registered SOP Instance UID; the first copy is kept. */
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

/** Whether this object, not merely an equal copy, is the registered instance. */
export const isRegistered = (state: RegistryState, instance: Instance) =>
  state.get(seriesKeyOf(instance.dataset))?.instances.get(keyOf(instance))
    ?.instance === instance;
