import type { Chunk } from '@/src/core/streaming/chunk';
import {
  planDicomCollections,
  type DicomCollection,
  type InstanceFacts,
} from '@/src/core/dicom/planDicomCollections';
import {
  assignIds,
  encodeCollectionKey,
  type CommittedCollection,
} from '@/src/core/dicom/assignCollectionIds';
import { readInstanceFacts, seriesKeyOf } from '@/src/core/dicom/instanceFacts';

export type CollectionUpdate = {
  id: string;
  seriesKey: string;
  collection: DicomCollection;
  // Every chunk the collection holds, in the collection's own order, index
  // aligned with collection.members.
  members: Chunk[];
  // Index aligned with members: the batch's own chunk wherever the batch
  // supplied that instance, so a re-import's provenance reaches the caller
  // while the image keeps the object it already decodes.
  provenance: Chunk[];
};

export type RegistrationResult = {
  updates: CollectionUpdate[];
  // Committed IDs the replan dissolved, whose members moved elsewhere.
  removed: string[];
  // Undoes this batch's registration for the named series, so a failed import
  // does not pin its chunks. Collections forgotten since the batch was planned
  // stay forgotten. Assumes the caller registered nothing since.
  rollback: (seriesKeys: Iterable<string>) => void;
  // Whether a collection of the series was forgotten since the batch was
  // planned, so a commit would bring back what the user removed.
  changedSince: (seriesKey: string) => boolean;
};

export type DicomCollectionRegistry = {
  register: (chunks: Chunk[]) => Promise<RegistrationResult>;
  forget: (collectionId: string) => void;
};

// An instance with no SOP Instance UID is identified by its chunk, so two of
// them never merge while re-registering one does not duplicate it.
type InstanceKey = string | Chunk;

type RegisteredInstance = {
  key: InstanceKey;
  chunk: Chunk;
  facts: InstanceFacts;
};

type Committed = {
  // The member keys the collection was last planned with, in order.
  members: InstanceKey[];
  // The encoded collection key, so a relabelled collection is reported even
  // when its members did not move.
  key: string;
};

type SeriesEntry = {
  instances: Map<InstanceKey, RegisteredInstance>;
  committed: Map<string, Committed>;
  // IDs the latest plan dissolved. They own nothing here any more, but the
  // store still shows them until that plan commits, so forgetting one is a
  // change the plan must hear about.
  dissolving: Set<string>;
  // Every collection ID forgotten from this series, in order.
  forgotten: string[];
  // Sequencing only: a settled queue holds no plan, so it pins no chunk.
  queue: Promise<void>;
};

type Snapshot = {
  entry: SeriesEntry;
  instances: SeriesEntry['instances'];
  committed: SeriesEntry['committed'];
  dissolving: SeriesEntry['dissolving'];
  forgotten: number;
};

const unread = () =>
  new Error('Cannot register a DICOM chunk whose metadata has not been read');

const readChunk = (chunk: Chunk) => {
  const { metadata } = chunk;
  if (!metadata) throw unread();
  const facts = readInstanceFacts(metadata);
  return {
    seriesKey: seriesKeyOf(metadata),
    instance: { key: facts.sopInstanceUid ?? chunk, chunk, facts },
  };
};

/** Groups preserve input order, both of the keys and of their members. */
const groupBy = <T>(items: T[], keyOf: (item: T) => string) => {
  const groups = new Map<string, T[]>();
  items.forEach((item) => {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  });
  return groups;
};

/**
 * Splits a batch into one list per series, preserving input order. Only the
 * series key is read here, since registration reads the rest of every chunk;
 * a batch naming an unread chunk still fails before any series transaction
 * starts.
 */
export const groupChunksBySeries = (chunks: Chunk[]) =>
  groupBy(chunks, (chunk) => {
    if (!chunk.metadata) throw unread();
    return seriesKeyOf(chunk.metadata);
  });

const groupBySeries = (chunks: Chunk[]) => {
  const groups = new Map<string, RegisteredInstance[]>();
  groupBy(chunks.map(readChunk), (read) => read.seriesKey).forEach(
    (reads, seriesKey) =>
      groups.set(
        seriesKey,
        reads.map((read) => read.instance)
      )
  );
  return groups;
};

const firstByKey = (instances: RegisteredInstance[]) => {
  const byKey = new Map<InstanceKey, Chunk>();
  instances.forEach((instance) => {
    if (!byKey.has(instance.key)) byKey.set(instance.key, instance.chunk);
  });
  return byKey;
};

// A collection holding no SOP Instance UID cannot be claimed back by overlap,
// so its ID is re-minted from its key instead of counting as taken.
const claimable = (committed: SeriesEntry['committed']) =>
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

function planSeries(
  entry: SeriesEntry,
  seriesKey: string,
  batch: RegisteredInstance[]
) {
  // The first registration of an instance owns its chunk: a re-supply only
  // reports back, so the chunk an image already holds stays the member.
  batch.forEach((instance) => {
    if (!entry.instances.has(instance.key))
      entry.instances.set(instance.key, instance);
  });

  const registered = [...entry.instances.values()];
  const plan = planDicomCollections({
    seriesKey,
    instances: registered.map((instance) => instance.facts),
  });
  const assigned = assignIds(plan, claimable(entry.committed));

  const instanceOf = new Map(
    registered.map((instance) => [instance.facts, instance])
  );
  const batchChunks = firstByKey(batch);

  const planned = assigned.collections.map(({ id, ...collection }) => {
    const instances = collection.members.map((facts) => instanceOf.get(facts)!);
    const committed: Committed = {
      members: instances.map((instance) => instance.key),
      key: encodeCollectionKey(collection.key),
    };
    return {
      id,
      collection,
      committed,
      members: instances.map((instance) => instance.chunk),
      provenance: instances.map(
        (instance) => batchChunks.get(instance.key) ?? instance.chunk
      ),
      supplied: committed.members.some((key) => batchChunks.has(key)),
    };
  });

  // A replan can move members between collections or split a collection out
  // under a new key, so such changes are reported even where the batch brought
  // the collection nothing.
  const updates = planned
    .filter(
      ({ id, committed, supplied }) =>
        supplied || !unchanged(entry.committed.get(id), committed)
    )
    .map(
      ({ id, collection, members, provenance }): CollectionUpdate => ({
        id,
        seriesKey,
        collection,
        members,
        provenance,
      })
    );

  const removed = [...entry.committed.keys()].filter(
    (id) => !planned.some((collection) => collection.id === id)
  );

  entry.committed = new Map(
    planned.map(({ id, committed }) => [id, committed])
  );
  entry.dissolving = new Set(removed);

  return { updates, removed };
}

/**
 * Remembers every instance seen so far, per series, and replans the series a
 * batch touches. Registration is serialized per series.
 */
export function createDicomCollectionRegistry(): DicomCollectionRegistry {
  const series = new Map<string, SeriesEntry>();

  const entryFor = (seriesKey: string) => {
    const existing = series.get(seriesKey);
    if (existing) return existing;
    const created: SeriesEntry = {
      instances: new Map(),
      committed: new Map(),
      dissolving: new Set(),
      forgotten: [],
      queue: Promise.resolve(),
    };
    series.set(seriesKey, created);
    return created;
  };

  // Releasing the instances releases the chunk bytes they hold. An ID a
  // replan already dissolved owns nothing, so forgetting it releases nothing
  // and the members it handed to another collection stay registered; it is
  // still recorded, once, as the change to the pending plan it is.
  const forgetFrom = (
    entry: SeriesEntry,
    seriesKey: string,
    collectionId: string
  ) => {
    const forgotten = entry.committed.get(collectionId);
    if (!forgotten) {
      if (entry.dissolving.delete(collectionId))
        entry.forgotten.push(collectionId);
      return;
    }
    forgotten.members.forEach((key) => entry.instances.delete(key));
    entry.committed.delete(collectionId);
    entry.forgotten.push(collectionId);
    if (entry.instances.size === 0) series.delete(seriesKey);
  };

  const register = async (chunks: Chunk[]) => {
    // Reading every chunk before touching a queue keeps a batch that names an
    // unread chunk from half registering.
    const batches = groupBySeries(chunks);
    const snapshots = new Map<string, Snapshot>();

    const planned = [...batches].map(([seriesKey, batch]) => {
      const entry = entryFor(seriesKey);
      const update = entry.queue.then(() => {
        snapshots.set(seriesKey, {
          entry,
          instances: new Map(entry.instances),
          committed: new Map(entry.committed),
          dissolving: new Set(entry.dissolving),
          forgotten: entry.forgotten.length,
        });
        return planSeries(entry, seriesKey, batch);
      });
      // A failed plan must not wedge the series behind it, and the queue
      // outlives every batch it orders, so it keeps the outcome and not the
      // plan: holding the members would pin the chunks of a collection the
      // user has since removed for as long as the series has any other.
      entry.queue = update.then(
        () => {},
        () => {}
      );
      return update;
    });

    // A forget empties and drops an entry once nothing is left in it, so the
    // series may now be missing or be a fresh entry.
    const changedSince = (seriesKey: string) => {
      const snapshot = snapshots.get(seriesKey);
      if (!snapshot) return false;
      const entry = series.get(seriesKey);
      return (
        entry !== snapshot.entry ||
        entry.forgotten.length !== snapshot.forgotten
      );
    };

    const rollback = (seriesKeys: Iterable<string>) =>
      [...new Set(seriesKeys)].forEach((seriesKey) => {
        const snapshot = snapshots.get(seriesKey);
        if (!snapshot) return;
        const { entry } = snapshot;
        entry.instances = snapshot.instances;
        entry.committed = snapshot.committed;
        entry.dissolving = snapshot.dissolving;
        // What the user removed while the batch was in flight stays removed.
        const forgotten = entry.forgotten.slice(snapshot.forgotten);
        entry.forgotten.length = snapshot.forgotten;
        series.set(seriesKey, entry);
        forgotten.forEach((id) => forgetFrom(entry, seriesKey, id));
      });

    const results = await Promise.all(planned);
    return {
      updates: results.flatMap((result) => result.updates),
      removed: results.flatMap((result) => result.removed),
      rollback,
      changedSince,
    };
  };

  const forget = (collectionId: string) => {
    series.forEach((entry, seriesKey) =>
      forgetFrom(entry, seriesKey, collectionId)
    );
  };

  return { register, forget };
}
