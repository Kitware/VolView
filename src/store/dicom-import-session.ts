import {
  Chunk,
  createDicomCollectionRegistry,
  type DicomCollectionRegistry,
} from '@/packages/dicom/core';

// One import session per store instance, so a fresh pinia replans from nothing
// and the chunks the registry holds stay outside reactive state.
type ImportSession = {
  registry: DicomCollectionRegistry;
  // Series key to the transaction the next import of that series waits on.
  lanes: Map<string, Promise<unknown>>;
  preparing: Map<string, Set<Chunk>>;
};

const sessions = new WeakMap<object, ImportSession>();

export const sessionFor = (store: object) => {
  const existing = sessions.get(store);
  if (existing) return existing;
  const created: ImportSession = {
    registry: createDicomCollectionRegistry(),
    lanes: new Map(),
    preparing: new Map(),
  };
  sessions.set(store, created);
  return created;
};

export const releaseUnregistered = (
  registry: DicomCollectionRegistry,
  chunks: Iterable<Chunk>
) => {
  // Provenance keeps header identity after an unused source releases bytes.
  for (const chunk of chunks) {
    if (chunk instanceof Chunk && !registry.has(chunk)) chunk.dispose();
  }
};

// Planning, preparing and committing one series must not interleave: a later
// replan can dissolve an ID an earlier call is still inserting, which would
// resurrect the dead volume. Lanes are per series, so one stuck import blocks
// only the series it names.
export const inSeriesTransaction = <T>(
  store: object,
  seriesKey: string,
  batch: Chunk[],
  run: () => Promise<T>
) => {
  const { registry, lanes, preparing } = sessionFor(store);
  const transaction = (lanes.get(seriesKey) ?? Promise.resolve()).then(
    async () => {
      const callerOwned = new Set(
        batch.filter((chunk) => !registry.has(chunk))
      );
      const deferred = new Set<Chunk>();
      preparing.set(seriesKey, deferred);
      let completed = false;
      try {
        const result = await run();
        completed = true;
        return result;
      } finally {
        preparing.delete(seriesKey);
        // A failed import returns only its new sources to the caller. Existing
        // members deleted during planning remain eligible for release even if
        // the batch re-supplied them before the registry captured its snapshot.
        releaseUnregistered(
          registry,
          [...deferred].filter((chunk) => completed || !callerOwned.has(chunk))
        );
      }
    }
  );
  // A lane outlives every import it sequences, so it keeps the outcome and not
  // the result: holding the last batch's chunks would pin its DICOM bytes for
  // the store's lifetime, past the point the user removed the volume.
  lanes.set(
    seriesKey,
    transaction.then(
      () => {},
      () => {}
    )
  );
  return transaction;
};
