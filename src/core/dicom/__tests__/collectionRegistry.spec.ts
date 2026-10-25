import { describe, expect, it } from 'vitest';
import type { Chunk } from '@/src/core/streaming/chunk';
import { Tags } from '@/src/core/dicomTags';
import {
  createDicomCollectionRegistry,
  type CollectionUpdate,
} from '@/src/core/dicom/collectionRegistry';
import { UNREADABLE_POSITION_WARNING } from '@/src/core/dicom/planDicomCollections';
import {
  mergingChunks,
  tilt,
} from '@/src/core/dicom/__tests__/orientationFixtures';

const SERIES_UID = '1.2.826.0.1.3680043.9.7';
const OTHER_SERIES_UID = '1.2.826.0.1.3680043.9.8';

type SliceOptions = {
  sop?: string | null;
  series?: string;
  z?: number | null;
  rows?: string;
  orientation?: string;
  instanceNumber?: number | null;
  // Extra tags, keyed 'gggg|eeee'.
  tags?: Record<string, string>;
};

let sopCounter = 0;

function chunkFor(options: SliceOptions = {}) {
  const {
    sop = `sop-${(sopCounter += 1)}`,
    series = SERIES_UID,
    z = 0,
    rows = '4',
    orientation = '1\\0\\0\\0\\1\\0',
    instanceNumber = 1,
    tags = {},
  } = options;

  const entries: Array<[string, string]> = [
    [Tags.StudyInstanceUID, '1.2.826.0.1.3680043.9.1'],
    [Tags.PatientID, 'patient-1'],
    [Tags.SeriesInstanceUID, series],
    [Tags.SeriesNumber, '1'],
    [Tags.Modality, 'MR'],
    [Tags.Rows, rows],
    [Tags.Columns, '4'],
    [Tags.SamplesPerPixel, '1'],
    [Tags.ImageOrientationPatient, orientation],
  ];
  if (sop !== null) entries.push([Tags.SOPInstanceUID, sop]);
  if (z !== null) entries.push([Tags.ImagePositionPatient, `0\\0\\${z}`]);
  if (instanceNumber !== null)
    entries.push(['0020|0013', String(instanceNumber)]);
  entries.push(...Object.entries(tags));

  return { metadata: entries } as unknown as Chunk;
}

const sopOf = (chunk: Chunk) =>
  Object.fromEntries(chunk.metadata!)[Tags.SOPInstanceUID];

const sops = (chunks: Chunk[]) => chunks.map(sopOf);

const byId = (updates: CollectionUpdate[]) =>
  [...updates].sort((left, right) => (left.id < right.id ? -1 : 1));

describe('DICOM collection registry', () => {
  it('plans one consistent series into one ordered collection', async () => {
    const registry = createDicomCollectionRegistry();
    const first = chunkFor({ sop: 'a', z: 0 });
    const second = chunkFor({ sop: 'b', z: 1 });
    const third = chunkFor({ sop: 'c', z: 2 });

    // Arrival order deliberately differs from slice order.
    const { updates } = await registry.register([third, first, second]);

    expect(updates).toHaveLength(1);
    const [update] = updates;
    expect(sops(update.members)).toEqual(['a', 'b', 'c']);
    expect(update.provenance).toEqual(update.members);
    expect(update.collection.order).toBe('spatial');
    expect(update.collection.diagnostics).toEqual([]);
  });

  it('aligns the chunk members with the planned facts', async () => {
    const registry = createDicomCollectionRegistry();
    const chunks = [chunkFor({ sop: 'a', z: 2 }), chunkFor({ sop: 'b', z: 0 })];

    const { updates } = await registry.register(chunks);
    const [update] = updates;

    expect(update.collection.members.map((m) => m.sopInstanceUid)).toEqual(
      sops(update.members)
    );
  });

  // The DICOMweb store reconciles its own series keyed progress against the
  // loaded volume id by prefix.
  it('mints an id that starts with the series instance uid', async () => {
    const registry = createDicomCollectionRegistry();

    const { updates } = await registry.register([chunkFor({ sop: 'a' })]);

    expect(updates[0].id.startsWith(SERIES_UID)).toBe(true);
  });

  it('keeps the collection id and grows its members across two batches', async () => {
    const registry = createDicomCollectionRegistry();
    const first = chunkFor({ sop: 'a', z: 0 });
    const second = chunkFor({ sop: 'b', z: 1 });

    const [firstUpdate] = (await registry.register([first])).updates;
    const [secondUpdate] = (await registry.register([second])).updates;

    expect(secondUpdate.id).toBe(firstUpdate.id);
    expect(sops(secondUpdate.members)).toEqual(['a', 'b']);
    // Every member reports its provenance, not just the one the batch brought.
    expect(secondUpdate.provenance).toEqual([first, second]);
  });

  it('orders a late arriving earlier slice into its planned position', async () => {
    const registry = createDicomCollectionRegistry();
    const first = chunkFor({ sop: 'a', z: 0 });
    const second = chunkFor({ sop: 'b', z: 1 });

    await registry.register([second]);
    const [update] = (await registry.register([first])).updates;

    expect(sops(update.members)).toEqual(['a', 'b']);
    expect(update.provenance).toEqual([first, second]);
  });

  const POSITIONS: Record<string, number> = { a: 0, b: 1, c: 2 };

  const loadBatches = (batches: ReadonlyArray<ReadonlyArray<string>>) => {
    const registry = createDicomCollectionRegistry();
    return batches.reduce(
      (chain, batch) =>
        chain.then(() =>
          registry
            .register(batch.map((sop) => chunkFor({ sop, z: POSITIONS[sop] })))
            .then((result) => result.updates)
        ),
      Promise.resolve([] as CollectionUpdate[])
    );
  };

  it.each([
    ['one batch', [['a', 'b', 'c']]],
    ['two batches', [['a'], ['b', 'c']]],
    ['two batches in reverse', [['b', 'c'], ['a']]],
    ['one slice at a time', [['c'], ['a'], ['b']]],
    [
      'a repeated batch',
      [
        ['a', 'b', 'c'],
        ['a', 'b', 'c'],
      ],
    ],
  ] as const)(
    'plans the whole series into one collection when loaded as %s',
    async (_case, batches) => {
      const updates = await loadBatches(batches);

      expect(updates).toHaveLength(1);
      expect(sops(updates[0].members)).toEqual(['a', 'b', 'c']);
    }
  );

  it('gives one series the same id however the slices are batched', async () => {
    const idOf = async (batches: ReadonlyArray<ReadonlyArray<string>>) =>
      (await loadBatches(batches))[0].id;

    const oneBatch = await idOf([['a', 'b', 'c']]);
    expect(await idOf([['a'], ['b', 'c']])).toBe(oneBatch);
    expect(await idOf([['b', 'c'], ['a']])).toBe(oneBatch);
    expect(
      await idOf([
        ['a', 'b', 'c'],
        ['a', 'b', 'c'],
      ])
    ).toBe(oneBatch);
  });

  it('keeps the first chunk registered for a repeated instance uid', async () => {
    const registry = createDicomCollectionRegistry();
    const original = chunkFor({ sop: 'a', z: 0 });
    const resupplied = chunkFor({ sop: 'a', z: 0 });

    await registry.register([original]);
    const [update] = (await registry.register([resupplied])).updates;

    expect(update.members).toEqual([original]);
    // The batch's own chunk still reports back, so its provenance can merge.
    expect(update.provenance).toEqual([resupplied]);
  });

  it('counts one chunk once however often a batch repeats it', async () => {
    const registry = createDicomCollectionRegistry();
    const chunk = chunkFor({ sop: 'a', z: 0 });

    const [update] = (await registry.register([chunk, chunk])).updates;

    expect(update.members).toEqual([chunk]);
  });

  it('never merges two instances that carry no instance uid', async () => {
    const registry = createDicomCollectionRegistry();
    const first = chunkFor({ sop: null, z: 0 });
    const second = chunkFor({ sop: null, z: 1 });

    const [update] = (await registry.register([first, second])).updates;

    expect(update.members).toEqual([first, second]);
  });

  it('re-registers an anonymous chunk without duplicating it', async () => {
    const registry = createDicomCollectionRegistry();
    const chunk = chunkFor({ sop: null, z: 0 });

    await registry.register([chunk]);
    const [update] = (await registry.register([chunk])).updates;

    expect(update.members).toEqual([chunk]);
  });

  it('splits one batch of incompatible instances into two collections', async () => {
    const registry = createDicomCollectionRegistry();
    const scout = chunkFor({ sop: 'scout', rows: '8', z: 0 });
    const slices = [chunkFor({ sop: 'a', z: 0 }), chunkFor({ sop: 'b', z: 1 })];

    const { updates } = await registry.register([scout, ...slices]);

    expect(updates).toHaveLength(2);
    const membership = updates.map((update) => sops(update.members));
    expect(membership).toContainEqual(['scout']);
    expect(membership).toContainEqual(['a', 'b']);
    expect(updates[0].id).not.toBe(updates[1].id);
    updates.forEach((update) =>
      expect(update.id.startsWith(SERIES_UID)).toBe(true)
    );
  });

  it('leaves an untouched collection out of a later batch', async () => {
    const registry = createDicomCollectionRegistry();
    const scout = chunkFor({ sop: 'scout', rows: '8', z: 0 });
    const slice = chunkFor({ sop: 'a', z: 0 });

    const [sliceUpdate] = (await registry.register([slice])).updates;
    const { updates } = await registry.register([scout]);

    expect(updates).toHaveLength(1);
    expect(sops(updates[0].members)).toEqual(['scout']);
    expect(updates[0].id).not.toBe(sliceUpdate.id);
  });

  it('reports a collection whose key changed without gaining a chunk', async () => {
    const registry = createDicomCollectionRegistry();
    const first = [0, 2].map((z) =>
      chunkFor({ sop: `one-${z}`, z, tags: { [Tags.AcquisitionNumber]: '1' } })
    );
    const second = [1, 3].map((z) =>
      chunkFor({ sop: `two-${z}`, z, tags: { [Tags.AcquisitionNumber]: '2' } })
    );

    const [{ id }] = (await registry.register(first)).updates;
    const { updates, removed } = await registry.register(second);

    // The first pass keeps its members and its id, but is now labelled as one
    // acquisition of two, so the store must hear about it.
    expect(removed).toEqual([]);
    expect(updates.map((update) => update.id)).toContain(id);
    const relabelled = updates.find((update) => update.id === id)!;
    expect(sops(relabelled.members)).toEqual(['one-0', 'one-2']);
    expect(relabelled.collection.label).toBe('acquisition 1');
  });

  // The positions of the two passes already earned their separation; a later
  // slice nothing spatial can be said about must not dissolve it.
  it('keeps two separated acquisitions when a positionless chunk arrives later', async () => {
    const registry = createDicomCollectionRegistry();
    const first = [0, 2, 4].map((z) =>
      chunkFor({ sop: `one-${z}`, z, tags: { [Tags.AcquisitionNumber]: '1' } })
    );
    const second = [1, 3, 5].map((z) =>
      chunkFor({ sop: `two-${z}`, z, tags: { [Tags.AcquisitionNumber]: '2' } })
    );

    const separated = byId(
      (await registry.register([...first, ...second])).updates
    );
    expect(separated).toHaveLength(2);

    const blind = chunkFor({ sop: 'blind', z: null, instanceNumber: 9 });
    const { updates, removed } = await registry.register([blind]);

    // Neither committed collection dissolved, and neither was re-planned.
    expect(removed).toEqual([]);
    expect(updates).toHaveLength(1);
    expect(updates[0].id).not.toBe(separated[0].id);
    expect(updates[0].id).not.toBe(separated[1].id);
    expect(sops(updates[0].members)).toEqual(['blind']);
    expect(updates[0].collection.warnings).toEqual([
      UNREADABLE_POSITION_WARNING,
    ]);

    // The two volumes still hold exactly the slices of their own pass.
    const again = byId(
      (await registry.register([...first, ...second])).updates
    );
    expect(again.map((update) => update.id)).toEqual(
      separated.map((update) => update.id)
    );
    expect(again.map((update) => sops(update.members))).toEqual([
      sops(separated[0].members),
      sops(separated[1].members),
    ]);
    expect(again.flatMap((update) => update.collection.warnings)).toEqual([]);
  });

  it('reports a collection a later batch re-registers unchanged', async () => {
    const registry = createDicomCollectionRegistry();
    const slice = chunkFor({ sop: 'a', z: 0 });

    await registry.register([slice]);
    const { updates } = await registry.register([slice]);

    expect(updates).toHaveLength(1);
    expect(updates[0].provenance).toEqual([slice]);
  });

  const merging = () => mergingChunks(chunkFor);

  it('reports the id a replan dissolved when two collections merge', async () => {
    const registry = createDicomCollectionRegistry();
    const { between, straight, tilted } = merging();

    const first = await registry.register([straight, tilted]);
    expect(first.updates).toHaveLength(2);
    expect(first.removed).toEqual([]);

    const second = await registry.register([between]);

    expect(second.updates).toHaveLength(1);
    expect(sops(second.updates[0].members)).toEqual([
      'sop-2',
      'sop-3',
      'sop-1',
    ]);
    expect(second.removed).toEqual(
      first.updates
        .map((update) => update.id)
        .filter((id) => id !== second.updates[0].id)
    );
  });

  it('reports a collection that lost members without gaining a chunk', async () => {
    const registry = createDicomCollectionRegistry();
    const straight = chunkFor({ sop: 'sop-2', z: 0, orientation: tilt(0) });
    const near = chunkFor({ sop: 'sop-3', z: 1, orientation: tilt(0.01) });
    // Agrees with the straight instance but not with the near one, so the
    // bucket it seeds as the new reference leaves the near one behind.
    const splitter = chunkFor({
      sop: 'sop-1',
      z: 2,
      orientation: tilt(-0.005),
    });

    const first = await registry.register([straight, near]);
    expect(first.updates).toHaveLength(1);

    const second = await registry.register([splitter]);

    const orphaned = second.updates.find(
      (update) => !update.members.includes(splitter)
    );
    expect(orphaned).toBeDefined();
    expect(sops(orphaned!.members)).toEqual(['sop-3']);
    expect(second.removed).toEqual([first.updates[0].id]);
  });

  it('lets a rolled back batch re-supply the chunk for its instance', async () => {
    const registry = createDicomCollectionRegistry();
    const malformed = chunkFor({ sop: 'a', z: 0 });
    const first = await registry.register([malformed]);

    first.rollback(first.updates.map((update) => update.seriesKey));

    const corrected = chunkFor({ sop: 'a', z: 0 });
    const second = await registry.register([corrected]);

    expect(second.updates[0].members).toHaveLength(1);
    expect(second.updates[0].members[0]).toBe(corrected);
    expect(second.updates[0].id).toBe(first.updates[0].id);
  });

  it('reports a collection forgotten after the batch was planned', async () => {
    const registry = createDicomCollectionRegistry();
    const slice = chunkFor({ sop: 'a', z: 0 });
    const [{ id }] = (await registry.register([slice])).updates;

    const { changedSince } = await registry.register([
      chunkFor({ sop: 'b', z: 1 }),
    ]);
    expect(changedSince(SERIES_UID)).toBe(false);

    registry.forget(id);

    expect(changedSince(SERIES_UID)).toBe(true);
    expect(changedSince(OTHER_SERIES_UID)).toBe(false);
  });

  it('reports a forget of a collection the pending plan dissolves', async () => {
    const registry = createDicomCollectionRegistry();
    const { between, straight, tilted } = merging();
    const first = await registry.register([straight]);
    const second = await registry.register([tilted]);
    const [straightId] = first.updates.map((update) => update.id);
    const [tiltedId] = second.updates.map((update) => update.id);

    // The between instance merges both into one; the store still shows the
    // dissolved one until this plan commits.
    const { removed, changedSince } = await registry.register([between]);
    expect(removed).toHaveLength(1);
    const dissolved = removed[0] === straightId ? straightId : tiltedId;

    registry.forget(dissolved);

    expect(changedSince(SERIES_UID)).toBe(true);
  });

  it('keeps a collection forgotten across the rollback of the batch that saw it', async () => {
    const registry = createDicomCollectionRegistry();
    const slice = chunkFor({ sop: 'a', z: 0 });
    const [{ id }] = (await registry.register([slice])).updates;

    const { rollback } = await registry.register([
      chunkFor({ sop: 'b', z: 1 }),
    ]);
    registry.forget(id);
    rollback([SERIES_UID]);

    // Neither the removed volume's member nor the abandoned batch's is held,
    // so the next import plans both afresh.
    const { updates, removed } = await registry.register([
      slice,
      chunkFor({ sop: 'b', z: 1 }),
    ]);
    expect(removed).toEqual([]);
    expect(updates).toHaveLength(1);
    expect(sops(updates[0].members)).toEqual(['a', 'b']);
    expect(sops(updates[0].provenance)).toEqual(['a', 'b']);
  });

  it('rolls back only the series it is given', async () => {
    const registry = createDicomCollectionRegistry();
    const kept = chunkFor({ sop: 'a', series: SERIES_UID });
    const undone = chunkFor({ sop: 'b', series: OTHER_SERIES_UID });

    const first = await registry.register([kept, undone]);
    const undoneUpdate = first.updates.find((update) =>
      update.members.includes(undone)
    )!;
    first.rollback([undoneUpdate.seriesKey]);

    const second = await registry.register([
      chunkFor({ sop: 'a', series: SERIES_UID }),
      chunkFor({ sop: 'b', series: OTHER_SERIES_UID }),
    ]);
    const bySeries = (uid: string) =>
      second.updates.find((update) => update.id.startsWith(uid))!;

    // Identity, not shape: the rolled back series drops its stale chunk.
    expect(bySeries(SERIES_UID).members[0]).toBe(kept);
    expect(bySeries(OTHER_SERIES_UID).members[0]).not.toBe(undone);
  });

  it('restores the collections a rolled back batch dissolved', async () => {
    const registry = createDicomCollectionRegistry();
    const { between, straight, tilted } = merging();

    await registry.register([straight, tilted]);
    const merged = await registry.register([between]);
    expect(merged.removed).toHaveLength(1);

    merged.rollback(merged.updates.map((update) => update.seriesKey));
    const retried = await registry.register([between]);

    expect(retried.removed).toEqual(merged.removed);
    expect(retried.updates[0].id).toBe(merged.updates[0].id);
    expect(sops(retried.updates[0].members)).toEqual([
      'sop-2',
      'sop-3',
      'sop-1',
    ]);
  });

  it('replans without the instances a forgotten collection held', async () => {
    const registry = createDicomCollectionRegistry();
    const original = chunkFor({ sop: 'a', z: 0 });
    const { updates } = await registry.register([original]);

    registry.forget(updates[0].id);
    const resupplied = chunkFor({ sop: 'a', z: 0 });
    const second = await registry.register([resupplied]);

    // Identity, not shape: the released chunk is an equal but stale object.
    expect(second.updates[0].members).toHaveLength(1);
    expect(second.updates[0].members[0]).toBe(resupplied);
    expect(second.updates[0].id).toBe(updates[0].id);
  });

  it('keeps the members a replan moved when the dissolved id is forgotten', async () => {
    const registry = createDicomCollectionRegistry();
    const { between, straight, tilted } = merging();

    await registry.register([straight, tilted]);
    const merged = await registry.register([between]);
    merged.removed.forEach((id) => registry.forget(id));

    const third = await registry.register([between]);

    expect(third.updates[0].members).toHaveLength(3);
  });

  it('forgets one collection of a series without touching the others', async () => {
    const registry = createDicomCollectionRegistry();
    const scout = chunkFor({ sop: 'scout', rows: '8', z: 0 });
    const slice = chunkFor({ sop: 'a', z: 0 });

    const { updates } = await registry.register([scout, slice]);
    const scoutUpdate = updates.find((update) => update.members[0] === scout)!;
    registry.forget(scoutUpdate.id);

    const resupplied = chunkFor({ sop: 'scout', rows: '8', z: 0 });
    const second = await registry.register([resupplied]);

    expect(second.updates).toHaveLength(1);
    expect(second.updates[0].members).toHaveLength(1);
    expect(second.updates[0].members[0]).toBe(resupplied);
    expect(second.removed).toEqual([]);
  });

  it('plans two series independently', async () => {
    const registry = createDicomCollectionRegistry();
    const first = chunkFor({ sop: 'a', series: SERIES_UID });
    const second = chunkFor({ sop: 'b', series: OTHER_SERIES_UID });

    const updates = byId((await registry.register([first, second])).updates);

    expect(updates).toHaveLength(2);
    expect(updates[0].id).not.toBe(updates[1].id);
    const forSeries = (uid: string) =>
      updates.find((update) => update.id.startsWith(uid))!;
    expect(forSeries(SERIES_UID).members).toEqual([first]);
    expect(forSeries(OTHER_SERIES_UID).members).toEqual([second]);
  });

  it('serializes overlapping registrations of one series', async () => {
    const registry = createDicomCollectionRegistry();
    const first = chunkFor({ sop: 'a', z: 0 });
    const second = chunkFor({ sop: 'b', z: 1 });

    const [firstResult, secondResult] = await Promise.all([
      registry.register([first]),
      registry.register([second]),
    ]);

    expect(sops(firstResult.updates[0].members)).toEqual(['a']);
    expect(sops(secondResult.updates[0].members)).toEqual(['a', 'b']);
    expect(secondResult.updates[0].id).toBe(firstResult.updates[0].id);
  });

  it('surfaces the planner order and diagnostics for a positionless series', async () => {
    const registry = createDicomCollectionRegistry();
    const chunks = [
      chunkFor({ sop: 'alpha', z: null, instanceNumber: 2 }),
      chunkFor({ sop: 'beta', z: null, instanceNumber: 1 }),
    ];

    const [update] = (await registry.register(chunks)).updates;

    expect(sops(update.members)).toEqual(['beta', 'alpha']);
    expect(update.collection.order).toBe('instance-number');
    const diagnostics = update.collection.diagnostics.join(' ');
    expect(diagnostics).toContain('alpha');
    expect(diagnostics).toContain('beta');
  });

  it('refuses a chunk whose metadata has not been read', async () => {
    const registry = createDicomCollectionRegistry();
    const chunk = { metadata: null } as unknown as Chunk;

    await expect(registry.register([chunk])).rejects.toThrow(/metadata/i);
  });

  it('does not mutate the batch it registers', async () => {
    const registry = createDicomCollectionRegistry();
    const chunks = [chunkFor({ sop: 'a', z: 2 }), chunkFor({ sop: 'b', z: 0 })];
    const order = [...chunks];

    await registry.register(chunks);

    expect(chunks).toEqual(order);
  });
});
