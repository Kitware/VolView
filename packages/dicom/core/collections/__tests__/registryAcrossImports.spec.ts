import { describe, expect, it } from 'vitest';
import { getDatasetTag } from '../../metadata/datasetAccess';
import { Tags } from '../../metadata/dicomTags';
import type { Instance } from '../../instance/readInstance';
import { instanceFor } from '@/tests/dicomDataset';
import {
  emptyRegistry,
  forgetCollection,
  isRegistered,
  registerInstances,
  type InstanceCollectionUpdate,
} from '../instanceRegistry';
import { UNREADABLE_POSITION_WARNING } from '../planDicomCollections';
import { mergingInstances, tilt } from '@/tests/dicomOrientationFixtures';
import { SERIES_UID, sliceDataset, type SliceOptions } from './sliceFixture';

const sliceInstance = (options: SliceOptions = {}) =>
  instanceFor(sliceDataset(options));

const sops = (instances: readonly Instance[]) =>
  instances.map((instance) =>
    getDatasetTag(instance.dataset, Tags.SOPInstanceUID)
  );

const byId = (updates: InstanceCollectionUpdate[]) =>
  [...updates].sort((left, right) => (left.id < right.id ? -1 : 1));

/** Keeps each returned state, as the store that owns the registry does. */
function createRegistry() {
  let state = emptyRegistry;
  return {
    register: (batch: Instance[]) => {
      const result = registerInstances(state, batch);
      state = result.state;
      return result;
    },
    forget: (id: string) => {
      state = forgetCollection(state, id);
    },
    has: (instance: Instance) => isRegistered(state, instance),
  };
}

const collidingMultiframes = (series = SERIES_UID) =>
  ['1', null].map((sop) =>
    sliceInstance({ sop, series, tags: { [Tags.NumberOfFrames]: '2' } })
  );

describe('instance registry across imports', () => {
  it('keeps anonymous clip ownership stable after deletion and another import', () => {
    const registry = createRegistry();
    const clips = [0, 1, 2].map(() =>
      sliceInstance({
        sop: null,
        tags: { [Tags.NumberOfFrames]: '3' },
      })
    );
    const before = registry.register(clips.slice(0, 2)).updates;
    const first = before.find((update) => update.members.includes(clips[0]))!;
    const second = before.find((update) => update.members.includes(clips[1]))!;
    expect(first.members).toEqual([clips[0]]);
    registry.forget(first.id);

    const after = registry.register([clips[2]]);

    expect(after.removed).not.toContain(second.id);
    const updated = after.updates.find((update) => update.id === second.id);
    if (updated) expect(updated.members[0]).toBe(clips[1]);
    expect(registry.has(clips[1])).toBe(true);
    expect(registry.has(clips[0])).toBe(false);
  });

  it('does not confuse a numeric UID with an anonymous clip identity', () => {
    const registry = createRegistry();
    const clips = collidingMultiframes();
    const { updates } = registry.register(clips);

    expect(updates).toHaveLength(2);
    expect(new Set(updates.map((update) => update.id)).size).toBe(2);
    expect(new Set(updates.flatMap((update) => update.members))).toEqual(
      new Set(clips)
    );
    clips.forEach((clip) => expect(registry.has(clip)).toBe(true));
  });

  it('plans one consistent series into one ordered collection', () => {
    const registry = createRegistry();
    const first = sliceInstance({ sop: 'a', z: 0 });
    const second = sliceInstance({ sop: 'b', z: 1 });
    const third = sliceInstance({ sop: 'c', z: 2 });

    // Arrival order deliberately differs from slice order.
    const { updates } = registry.register([third, first, second]);

    expect(updates).toHaveLength(1);
    const [update] = updates;
    expect(sops(update.members)).toEqual(['a', 'b', 'c']);
    expect(update.provenance).toEqual(update.members);
    expect(update.collection.order).toBe('spatial');
    expect(update.collection.diagnostics).toEqual([]);
  });

  it('aligns the instance members with the planned facts', () => {
    const registry = createRegistry();
    const instances = [
      sliceInstance({ sop: 'a', z: 2 }),
      sliceInstance({ sop: 'b', z: 0 }),
    ];

    const { updates } = registry.register(instances);
    const [update] = updates;

    expect(update.collection.members.map((m) => m.sopInstanceUid)).toEqual(
      sops(update.members)
    );
  });

  // The DICOMweb store reconciles its own series keyed progress against the
  // loaded volume id by prefix.
  it('mints an id that starts with the series instance uid', () => {
    const registry = createRegistry();

    const { updates } = registry.register([sliceInstance({ sop: 'a' })]);

    expect(updates[0].id.startsWith(SERIES_UID)).toBe(true);
  });

  it('keeps the collection id and grows its members across two batches', () => {
    const registry = createRegistry();
    const first = sliceInstance({ sop: 'a', z: 0 });
    const second = sliceInstance({ sop: 'b', z: 1 });

    const [firstUpdate] = registry.register([first]).updates;
    const [secondUpdate] = registry.register([second]).updates;

    expect(secondUpdate.id).toBe(firstUpdate.id);
    expect(sops(secondUpdate.members)).toEqual(['a', 'b']);
    // Every member reports its provenance, not just the one the batch brought.
    expect(secondUpdate.provenance).toEqual([first, second]);
  });

  it('orders a late arriving earlier slice into its planned position', () => {
    const registry = createRegistry();
    const first = sliceInstance({ sop: 'a', z: 0 });
    const second = sliceInstance({ sop: 'b', z: 1 });

    registry.register([second]);
    const [update] = registry.register([first]).updates;

    expect(sops(update.members)).toEqual(['a', 'b']);
    expect(update.provenance).toEqual([first, second]);
  });

  const POSITIONS: Record<string, number> = { a: 0, b: 1, c: 2 };

  const loadBatches = (batches: ReadonlyArray<ReadonlyArray<string>>) => {
    const registry = createRegistry();
    return batches.reduce(
      (_, batch) =>
        registry.register(
          batch.map((sop) => sliceInstance({ sop, z: POSITIONS[sop] }))
        ).updates,
      [] as InstanceCollectionUpdate[]
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
    (_case, batches) => {
      const updates = loadBatches(batches);

      expect(updates).toHaveLength(1);
      expect(sops(updates[0].members)).toEqual(['a', 'b', 'c']);
    }
  );

  it('gives one series the same id however the slices are batched', () => {
    const idOf = (batches: ReadonlyArray<ReadonlyArray<string>>) =>
      loadBatches(batches)[0].id;

    const oneBatch = idOf([['a', 'b', 'c']]);
    expect(idOf([['a'], ['b', 'c']])).toBe(oneBatch);
    expect(idOf([['b', 'c'], ['a']])).toBe(oneBatch);
    expect(
      idOf([
        ['a', 'b', 'c'],
        ['a', 'b', 'c'],
      ])
    ).toBe(oneBatch);
  });

  it.each([
    { sop: '  a  ', series: `  ${SERIES_UID}  ` },
    { sop: null, series: SERIES_UID },
    { sop: null, series: null },
    { sop: '', series: SERIES_UID },
    { sop: '   ', series: '' },
    { sop: 'a', series: '   ' },
  ])('recognizes only the canonical member for identity %j', (identity) => {
    const registry = createRegistry();
    const original = sliceInstance(identity);
    const duplicate = sliceInstance(identity);

    const { updates } = registry.register([original]);

    expect(registry.has(original)).toBe(true);
    expect(registry.has(duplicate)).toBe(false);
    registry.forget(updates[0].id);
    expect(registry.has(original)).toBe(false);
  });

  it('counts one instance once however often a batch repeats it', () => {
    const registry = createRegistry();
    const instance = sliceInstance({ sop: 'a', z: 0 });

    const [update] = registry.register([instance, instance]).updates;

    expect(update.members).toEqual([instance]);
  });

  it('re-registers an anonymous instance without duplicating it', () => {
    const registry = createRegistry();
    const instance = sliceInstance({ sop: null, z: 0 });

    registry.register([instance]);
    const [update] = registry.register([instance]).updates;

    expect(update.members).toEqual([instance]);
  });

  it('splits one batch of incompatible instances into two collections', () => {
    const registry = createRegistry();
    const scout = sliceInstance({ sop: 'scout', rows: '8', z: 0 });
    const slices = [
      sliceInstance({ sop: 'a', z: 0 }),
      sliceInstance({ sop: 'b', z: 1 }),
    ];

    const { updates } = registry.register([scout, ...slices]);

    expect(updates).toHaveLength(2);
    const membership = updates.map((update) => sops(update.members));
    expect(membership).toContainEqual(['scout']);
    expect(membership).toContainEqual(['a', 'b']);
    expect(updates[0].id).not.toBe(updates[1].id);
    updates.forEach((update) =>
      expect(update.id.startsWith(SERIES_UID)).toBe(true)
    );
  });

  it('leaves an untouched collection out of a later batch', () => {
    const registry = createRegistry();
    const scout = sliceInstance({ sop: 'scout', rows: '8', z: 0 });
    const slice = sliceInstance({ sop: 'a', z: 0 });

    const [sliceUpdate] = registry.register([slice]).updates;
    const { updates } = registry.register([scout]);

    expect(updates).toHaveLength(1);
    expect(sops(updates[0].members)).toEqual(['scout']);
    expect(updates[0].id).not.toBe(sliceUpdate.id);
  });

  // The positions of the two passes already earned their separation; a later
  // slice nothing spatial can be said about must not dissolve it.
  it('keeps two separated acquisitions when a positionless instance arrives later', () => {
    const registry = createRegistry();
    const first = [0, 2, 4].map((z) =>
      sliceInstance({
        sop: `one-${z}`,
        z,
        tags: { [Tags.AcquisitionNumber]: '1' },
      })
    );
    const second = [1, 3, 5].map((z) =>
      sliceInstance({
        sop: `two-${z}`,
        z,
        tags: { [Tags.AcquisitionNumber]: '2' },
      })
    );

    const separated = byId(registry.register([...first, ...second]).updates);
    expect(separated).toHaveLength(2);

    const blind = sliceInstance({ sop: 'blind', z: null, instanceNumber: 9 });
    const { updates, removed } = registry.register([blind]);

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
    const again = byId(registry.register([...first, ...second]).updates);
    expect(again.map((update) => update.id)).toEqual(
      separated.map((update) => update.id)
    );
    expect(again.map((update) => sops(update.members))).toEqual([
      sops(separated[0].members),
      sops(separated[1].members),
    ]);
    expect(again.flatMap((update) => update.collection.warnings)).toEqual([]);
  });

  it('reports a collection a later batch re-registers unchanged', () => {
    const registry = createRegistry();
    const slice = sliceInstance({ sop: 'a', z: 0 });

    registry.register([slice]);
    const { updates } = registry.register([slice]);

    expect(updates).toHaveLength(1);
    expect(updates[0].provenance).toEqual([slice]);
  });

  const merging = () => mergingInstances(sliceInstance);

  it('reports a collection that lost members without gaining an instance', () => {
    const registry = createRegistry();
    const straight = sliceInstance({
      sop: 'sop-2',
      z: 0,
      orientation: tilt(0),
    });
    const near = sliceInstance({ sop: 'sop-3', z: 1, orientation: tilt(0.01) });
    // Agrees with the straight instance but not with the near one, so the
    // bucket it seeds as the new reference leaves the near one behind.
    const splitter = sliceInstance({
      sop: 'sop-1',
      z: 2,
      orientation: tilt(-0.005),
    });

    const first = registry.register([straight, near]);
    expect(first.updates).toHaveLength(1);

    const second = registry.register([splitter]);

    const orphaned = second.updates.find(
      (update) => !update.members.includes(splitter)
    );
    expect(orphaned).toBeDefined();
    expect(sops(orphaned!.members)).toEqual(['sop-3']);
    expect(second.removed).toEqual([first.updates[0].id]);
  });

  it('replans without the instances a forgotten collection held', () => {
    const registry = createRegistry();
    const original = sliceInstance({ sop: 'a', z: 0 });
    const { updates } = registry.register([original]);

    registry.forget(updates[0].id);
    const resupplied = sliceInstance({ sop: 'a', z: 0 });
    const second = registry.register([resupplied]);

    // Identity, not shape: the released instance is an equal but stale object.
    expect(second.updates[0].members).toHaveLength(1);
    expect(second.updates[0].members[0]).toBe(resupplied);
    expect(second.updates[0].id).toBe(updates[0].id);
  });

  it('keeps the members a replan moved when the dissolved id is forgotten', () => {
    const registry = createRegistry();
    const { between, straight, tilted } = merging();

    registry.register([straight, tilted]);
    const merged = registry.register([between]);
    merged.removed.forEach((id) => registry.forget(id));

    const third = registry.register([between]);

    expect(third.updates[0].members).toHaveLength(3);
  });

  it('forgets one collection of a series without touching the others', () => {
    const registry = createRegistry();
    const scout = sliceInstance({ sop: 'scout', rows: '8', z: 0 });
    const slice = sliceInstance({ sop: 'a', z: 0 });

    const { updates } = registry.register([scout, slice]);
    const scoutUpdate = updates.find((update) => update.members[0] === scout)!;
    registry.forget(scoutUpdate.id);

    const resupplied = sliceInstance({ sop: 'scout', rows: '8', z: 0 });
    const second = registry.register([resupplied]);

    expect(second.updates).toHaveLength(1);
    expect(second.updates[0].members).toHaveLength(1);
    expect(second.updates[0].members[0]).toBe(resupplied);
    expect(second.removed).toEqual([]);
  });

  it('surfaces the planner order and diagnostics for a positionless series', () => {
    const registry = createRegistry();
    const instances = [
      sliceInstance({ sop: 'alpha', z: null, instanceNumber: 2 }),
      sliceInstance({ sop: 'beta', z: null, instanceNumber: 1 }),
    ];

    const [update] = registry.register(instances).updates;

    expect(sops(update.members)).toEqual(['beta', 'alpha']);
    expect(update.collection.order).toBe('instance-number');
    const diagnostics = update.collection.diagnostics.join(' ');
    expect(diagnostics).toContain('alpha');
    expect(diagnostics).toContain('beta');
  });

  it('does not mutate the batch it registers', () => {
    const registry = createRegistry();
    const instances = [
      sliceInstance({ sop: 'a', z: 2 }),
      sliceInstance({ sop: 'b', z: 0 }),
    ];
    const order = [...instances];

    registry.register(instances);

    expect(instances).toEqual(order);
  });
});

describe('registry normalization and conflicting identities', () => {
  it('keeps slices with absent and explicit single-frame counts in one volume', () => {
    const registry = createRegistry();
    const result = registry.register([
      sliceInstance({ sop: 'first', z: 0 }),
      sliceInstance({
        sop: 'second',
        z: 1,
        tags: { [Tags.NumberOfFrames]: '1' },
      }),
    ]);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0].members).toHaveLength(2);
    expect(result.updates[0].collection.reconstruction.sliceSpacing).toBe(1);
  });
});
