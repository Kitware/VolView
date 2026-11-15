import { describe, it, expect } from 'vitest';
import { assignIds, encodeCollectionKey } from '../assignCollectionIds';
import type { CommittedCollection } from '../assignCollectionIds';
import { ORIENTATION_TOLERANCE } from '../orientation';
import { planDicomCollections } from '../planDicomCollections';
import type { CollectionKey, DicomCollection } from '../planDicomCollections';
import {
  IDENTITY_ORIENTATION,
  makeFacts,
  tiltedOrientation,
} from './instanceFactsFixture';

const SERIES_KEY = 'series-1';

// A second orientation row rotation the bucketing tolerance still accepts.
const WITHIN_TOLERANCE = Math.acos(1 - ORIENTATION_TOLERANCE / 2);

const keyOf = (orientation: string): CollectionKey => ({
  seriesKey: SERIES_KEY,
  parts: [
    ['seriesNumber', '1'],
    ['sliceThickness', '1'],
    ['orientation', orientation],
  ],
});

const collectionOf = (
  uids: Array<string | null>,
  key = keyOf('1,0,0,0,1,0')
): DicomCollection => ({
  key,
  members: uids.map((uid) => makeFacts(uid)),
  reconstruction: { kind: 'regular', sliceSpacing: null },
  orientation: [1, 0, 0, 0, 1, 0],
  label: null,
  warnings: [],
});

const idsOf = (collections: Array<{ id: string }>) =>
  collections.map((c) => c.id);

describe('encodeCollectionKey', () => {
  // The structured key this encodes: the same characters the encoding joins on,
  // smuggled inside a series key or a value.
  const structured: CollectionKey = {
    seriesKey: SERIES_KEY,
    parts: [
      ['rows', '4'],
      ['columns', '8'],
    ],
  };

  const smuggled: Array<[string, CollectionKey]> = [
    [
      'the series key',
      { seriesKey: `${SERIES_KEY}|rows=.4`, parts: [['columns', '8']] },
    ],
    ['a value', { seriesKey: SERIES_KEY, parts: [['rows', '4|columns=.8']] }],
  ];

  it.each(smuggled)(
    'does not collide when a separator hides in %s',
    (_where, key) => {
      expect(encodeCollectionKey(key)).not.toBe(
        encodeCollectionKey(structured)
      );
    }
  );

  it('separates a missing value from the literal strings for it', () => {
    const literals = [null, 'null', '', '~'].map(
      (value): CollectionKey => ({
        seriesKey: SERIES_KEY,
        parts: [['rows', value]],
      })
    );

    const encodings = literals.map(encodeCollectionKey);

    expect(new Set(encodings).size).toBe(literals.length);
  });
});

describe('assignIds', () => {
  it('mints the encoded key when nothing is committed', () => {
    const collection = collectionOf(['a', 'b']);

    const collections = assignIds([collection], []);

    expect(collections[0].id).toBe(encodeCollectionKey(collection.key));
  });

  it('keeps the committed id when key and members are unchanged', () => {
    const collection = collectionOf(['a', 'b']);
    const committed: CommittedCollection[] = [
      { id: 'visible-1', sopInstanceUids: ['a', 'b'] },
    ];

    const collections = assignIds([collection], committed);

    expect(collections[0].id).toBe('visible-1');
  });

  it('keeps the committed id when a later batch changes the bucket key', () => {
    // A lower-sorting SOP UID takes over as the orientation bucket's
    // representative, so the second batch keys the same dataset differently.
    const firstBatch = [
      makeFacts('uid-m', {
        orientation: IDENTITY_ORIENTATION,
        projectedPosition: 0,
      }),
      makeFacts('uid-n', {
        orientation: IDENTITY_ORIENTATION,
        projectedPosition: 1,
      }),
    ];
    const newcomer = makeFacts('uid-a', {
      orientation: tiltedOrientation(WITHIN_TOLERANCE),
      projectedPosition: 2,
    });

    const before = assignIds(
      planDicomCollections({ seriesKey: SERIES_KEY, instances: firstBatch }),
      []
    );
    const committed = before.map((collection) => ({
      id: collection.id,
      sopInstanceUids: collection.members.flatMap((member) =>
        member.sopInstanceUid === null ? [] : [member.sopInstanceUid]
      ),
    }));
    const after = assignIds(
      planDicomCollections({
        seriesKey: SERIES_KEY,
        instances: [...firstBatch, newcomer],
      }),
      committed
    );

    expect(after).toHaveLength(1);
    expect(encodeCollectionKey(after[0].key)).not.toBe(
      encodeCollectionKey(before[0].key)
    );
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].id).not.toBe(encodeCollectionKey(after[0].key));
  });

  it('gives a committed id to the collection holding most of its members', () => {
    const majority = collectionOf(['a', 'b', 'c'], keyOf('1,0,0,0,1,0'));
    const remainder = collectionOf(['d'], keyOf('0,1,0,0,0,1'));
    const committed: CommittedCollection[] = [
      { id: 'visible-1', sopInstanceUids: ['a', 'b', 'c', 'd'] },
    ];

    const collections = assignIds([majority, remainder], committed);

    expect(collections[0].id).toBe('visible-1');
    expect(collections[1].id).not.toBe('visible-1');
  });

  it('mints for both halves of an evenly split committed collection', () => {
    const left = collectionOf(['a', 'b'], keyOf('1,0,0,0,1,0'));
    const right = collectionOf(['c', 'd'], keyOf('0,1,0,0,0,1'));
    const committed: CommittedCollection[] = [
      { id: 'visible-1', sopInstanceUids: ['a', 'b', 'c', 'd'] },
    ];

    const collections = assignIds([left, right], committed);

    expect(idsOf(collections)).not.toContain('visible-1');
    expect(new Set(idsOf(collections)).size).toBe(2);
  });

  it('mints when nothing overlaps, without reusing a committed id', () => {
    const collection = collectionOf(['a']);
    const committed: CommittedCollection[] = [
      { id: 'visible-1', sopInstanceUids: ['x', 'y'] },
    ];

    const collections = assignIds([collection], committed);

    expect(collections[0].id).not.toBe('visible-1');
    expect(collections[0].id).toBe(encodeCollectionKey(collection.key));
  });

  it('never mints an id already taken by a committed collection', () => {
    const collection = collectionOf(['a']);
    const committed: CommittedCollection[] = [
      {
        id: encodeCollectionKey(collection.key),
        sopInstanceUids: ['x'],
      },
    ];

    const collections = assignIds([collection], committed);

    expect(collections[0].id).not.toBe(committed[0].id);
  });

  it('prefers the committed collection it overlaps most', () => {
    const collection = collectionOf(['a', 'b', 'c', 'd', 'e']);
    const committed: CommittedCollection[] = [
      { id: 'small', sopInstanceUids: ['a', 'b'] },
      { id: 'large', sopInstanceUids: ['c', 'd', 'e'] },
    ];

    const collections = assignIds([collection], committed);

    expect(collections[0].id).toBe('large');
  });

  it('breaks an equal overlap on the smallest committed id', () => {
    const collection = collectionOf(['a', 'b', 'c', 'd']);
    const committed: CommittedCollection[] = [
      { id: 'zeta', sopInstanceUids: ['a', 'b'] },
      { id: 'alpha', sopInstanceUids: ['c', 'd'] },
    ];

    const collections = assignIds([collection], committed);

    expect(collections[0].id).toBe('alpha');
  });

  it('measures overlap only on members that have a SOP Instance UID', () => {
    const collection = collectionOf([null, 'a']);
    const committed: CommittedCollection[] = [
      { id: 'visible-1', sopInstanceUids: ['a'] },
    ];

    const collections = assignIds([collection], committed);

    expect(collections[0].id).toBe('visible-1');
  });

  it('mints for a collection whose members all lack a SOP Instance UID', () => {
    const collection = collectionOf([null, null]);
    const committed: CommittedCollection[] = [
      { id: 'visible-1', sopInstanceUids: ['a'] },
    ];

    const collections = assignIds([collection], committed);

    expect(collections[0].id).not.toBe('visible-1');
  });
});
