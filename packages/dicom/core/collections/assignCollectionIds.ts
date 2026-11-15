import type { CollectionKey, DicomCollection } from './planDicomCollections';

export type CommittedCollection = {
  id: string;
  sopInstanceUids: string[];
};

// A present value is prefixed, so it can never collide with the missing marker.
const encodeValue = (value: string | null) =>
  value === null ? '~' : `.${encodeURIComponent(value)}`;

/**
 * Encoding of a structured key, safe to use as a store ID. encodeURIComponent
 * escapes every separator a value can carry, so the join characters cannot
 * appear inside a component.
 */
export function encodeCollectionKey(key: CollectionKey) {
  return [
    encodeURIComponent(key.seriesKey),
    ...key.parts.map(
      ([rule, value]) => `${encodeURIComponent(rule)}=${encodeValue(value)}`
    ),
  ].join('|');
}

const uidsOf = (collection: DicomCollection) =>
  new Set(
    collection.members
      .map((member) => member.sopInstanceUid)
      .filter((uid): uid is string => uid !== null)
  );

const overlapSize = (planned: Set<string>, committed: Set<string>) =>
  [...planned].filter((uid) => committed.has(uid)).length;

const mint = (key: CollectionKey, taken: Set<string>) => {
  const base = encodeCollectionKey(key);
  if (!taken.has(base)) return base;
  const next = (suffix: number): string => {
    const candidate = `${base}~${suffix}`;
    return taken.has(candidate) ? next(suffix + 1) : candidate;
  };
  return next(2);
};

/**
 * Carries a committed ID over to the collection holding the plurality of its
 * members; mints a fresh ID from the key otherwise.
 */
export function assignIds(
  planned: DicomCollection[],
  committedIds: CommittedCollection[]
) {
  const plannedUids = planned.map(uidsOf);
  const committedUids = committedIds.map(
    (committed) => new Set(committed.sopInstanceUids)
  );

  // A committed ID moves only where its members are not split more evenly
  // elsewhere: the plurality holder must be strictly ahead of every rival.
  const claimable = committedIds.map((committed, committedIndex) => {
    const overlaps = plannedUids.map((uids) =>
      overlapSize(uids, committedUids[committedIndex])
    );
    const best = Math.max(0, ...overlaps);
    const holders = overlaps.filter((size) => size === best).length;
    return best > 0 && holders === 1
      ? { plannedIndex: overlaps.indexOf(best), overlap: best, committed }
      : null;
  });

  const claimFor = (plannedIndex: number) =>
    claimable
      .filter(
        (claim): claim is NonNullable<typeof claim> =>
          claim !== null && claim.plannedIndex === plannedIndex
      )
      .sort(
        (left, right) =>
          right.overlap - left.overlap ||
          (left.committed.id < right.committed.id ? -1 : 1)
      )[0];

  const taken = new Set(committedIds.map((committed) => committed.id));

  return planned.map((collection, index) => {
    const claim = claimFor(index);
    const id = claim ? claim.committed.id : mint(collection.key, taken);
    taken.add(id);
    return { ...collection, id };
  });
}
