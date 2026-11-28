import { describe, expect, it } from 'vitest';
import { getDatasetTag } from '../../metadata/datasetAccess';
import { Tags } from '../../metadata/dicomTags';
import type { Instance } from '../../instance/readInstance';
import { instanceFor } from '@/tests/dicomDataset';
import {
  emptyRegistry,
  forgetCollection,
  registerInstances,
} from '../instanceRegistry';
import { mergingInstances, tilt } from '@/tests/dicomOrientationFixtures';
import {
  OTHER_SERIES_UID,
  SERIES_UID,
  sliceDataset,
  type SliceOptions,
} from './sliceFixture';

const slice = (options: SliceOptions = {}) =>
  instanceFor(sliceDataset(options));

const sopsOf = (instances: readonly Instance[]) =>
  instances.map((instance) =>
    getDatasetTag(instance.dataset, Tags.SOPInstanceUID)
  );

/** Registers batches in order, keeping each returned state as a store would. */
const registerAll = (batches: Instance[][], initial = emptyRegistry) =>
  batches.reduce(
    (results, batch) => [
      ...results,
      registerInstances(results.at(-1)?.state ?? initial, batch),
    ],
    [] as ReturnType<typeof registerInstances>[]
  );

const lastUpdates = (batches: Instance[][]) =>
  registerAll(batches).at(-1)!.updates;

const acquisition = (number: string, zs: number[], orientation?: string) =>
  zs.map((z) =>
    slice({
      sop: `${number}-${z}`,
      z,
      orientation,
      tags: { [Tags.AcquisitionNumber]: number },
    })
  );

describe('pure instance registry', () => {
  it('orders a series into one collection whose members align with the plan', () => {
    const [a, b, c] = [0, 1, 2].map((z) => slice({ sop: `s${z}`, z }));

    const [update] = lastUpdates([[c, a, b]]);

    expect(update.members).toEqual([a, b, c]);
    expect(update.provenance).toEqual([a, b, c]);
    expect(update.collection.members.map((m) => m.sopInstanceUid)).toEqual(
      sopsOf(update.members)
    );
    expect(update.id.startsWith(SERIES_UID)).toBe(true);
  });

  // Anonymizers and phantom protocols can reuse one series' UIDs in another study.
  it.each([
    ['its own', 'b'],
    ['the same', 'a'],
  ])(
    'plans a series uid reused in another study, with %s SOP uids, apart',
    (_name, prefix) => {
      const study = (uid: string, sop: string) =>
        [0, 1, 2].map((z) =>
          slice({
            sop: `${sop}${z}`,
            z,
            tags: { [Tags.StudyInstanceUID]: uid },
          })
        );
      const first = study('1.2.3.1', 'a');
      const second = study('1.2.3.2', prefix);

      const [initial, reused] = registerAll([first, second]);

      expect(reused.updates.map((update) => update.members)).toEqual([second]);
      expect(reused.updates[0].id).not.toBe(initial.updates[0].id);
      expect(reused.updates[0].id.startsWith(SERIES_UID)).toBe(true);
    }
  );

  it.each([
    ['one batch', [[0, 1, 2]]],
    ['a late earlier slice', [[1, 2], [0]]],
    ['one at a time', [[2], [0], [1]]],
  ])('keeps one id and one ordering when loaded as %s', (_name, zs) => {
    const slices = [0, 1, 2].map((z) => slice({ sop: `b${z}`, z }));
    const once = lastUpdates([slices]);

    const batched = lastUpdates(zs.map((batch) => batch.map((z) => slices[z])));

    expect(batched).toHaveLength(1);
    expect(batched[0].id).toBe(once[0].id);
    expect(batched[0].members).toEqual(slices);
  });

  it('keeps the first registration of a SOP Instance UID and reports the re-supply', () => {
    const original = slice({ sop: 'same', z: 0 });
    const resupplied = slice({ sop: 'same', z: 0 });

    const [first, second] = registerAll([[original], [resupplied]]);

    expect(second.updates[0].id).toBe(first.updates[0].id);
    expect(second.updates[0].members).toHaveLength(1);
    expect(second.updates[0].members[0]).toBe(original);
    expect(second.updates[0].provenance[0]).toBe(resupplied);
  });

  it('reports a conflicting copy under a registered UID and keeps the first', () => {
    const original = slice({ sop: 'same', z: 0 });
    const conflicting = slice({ sop: 'same', z: 1 });

    const second = registerAll([[original], [conflicting]])[1];

    expect(second.conflictingInstanceUids).toEqual(['same']);
    expect(second.updates[0].members[0]).toBe(original);
    expect(second.updates[0].provenance[0]).toBe(original);
  });

  it('identifies instances without a UID by object', () => {
    const first = slice({ sop: null, z: 0 });
    const second = slice({ sop: null, z: 1 });

    const results = registerAll([[first, second, first], [first]]);

    expect(results[0].updates[0].members).toEqual([first, second]);
    expect(results[1].updates[0].members).toEqual([first, second]);
  });

  it.each([
    { sop: '  a  ', series: `  ${SERIES_UID}  ` },
    { sop: '1.2.3\0\0', series: SERIES_UID },
    { sop: 'a', series: '   ' },
  ])('recognizes a copy of the padded identity %j', (identity) => {
    const original = slice(identity);

    const [update] = lastUpdates([[original], [slice(identity)]]);

    expect(update.members).toHaveLength(1);
    expect(update.members[0]).toBe(original);
  });

  it.each([
    { sop: null, series: null },
    { sop: '', series: SERIES_UID },
    { sop: '   ', series: '' },
  ])('never merges copies of the blank identity %j', (identity) => {
    const [update] = lastUpdates([[slice(identity), slice(identity)]]);

    expect(update.members).toHaveLength(2);
  });

  it('keeps anonymous clip ownership stable after deletion and another import', () => {
    const clips = [0, 1, 2].map(() =>
      slice({ sop: null, tags: { [Tags.NumberOfFrames]: '3' } })
    );
    const before = registerInstances(emptyRegistry, clips.slice(0, 2));
    const idOf = (clip: Instance) =>
      before.updates.find((update) => update.members[0] === clip)!.id;

    const after = registerInstances(
      forgetCollection(before.state, idOf(clips[0])),
      [clips[2]]
    );
    const again = registerInstances(after.state, [clips[1], clips[0]]);

    expect(after.removed).toEqual([]);
    expect(
      again.updates.map(({ id, members, unchanged }) => [
        id,
        members[0],
        unchanged,
      ])
    ).toContainEqual([idOf(clips[1]), clips[1], true]);
    expect(
      again.updates.find((update) => update.members[0] === clips[0])!.unchanged
    ).toBe(false);
  });

  it('does not confuse a numeric UID with an anonymous clip identity', () => {
    const clips = ['1', null].map((sop) =>
      slice({ sop, tags: { [Tags.NumberOfFrames]: '2' } })
    );

    const updates = lastUpdates([clips]);

    expect(updates).toHaveLength(2);
    expect(new Set(updates.map((update) => update.id)).size).toBe(2);
    expect(new Set(updates.flatMap((update) => update.members))).toEqual(
      new Set(clips)
    );
  });

  it('keeps slices with absent and explicit single-frame counts in one volume', () => {
    const [update] = lastUpdates([
      [
        slice({ sop: 'first', z: 0 }),
        slice({ sop: 'second', z: 1, tags: { [Tags.NumberOfFrames]: '1' } }),
      ],
    ]);

    expect(update.members).toHaveLength(2);
    expect(update.collection.reconstruction.sliceSpacing).toBe(1);
  });

  it('splits one batch of incompatible instances into two collections', () => {
    const scout = slice({ sop: 'scout', rows: '8', z: 0 });
    const slices = [slice({ sop: 'a', z: 0 }), slice({ sop: 'b', z: 1 })];

    const updates = lastUpdates([[scout, ...slices]]);

    expect(updates.map((update) => sopsOf(update.members)).sort()).toEqual([
      ['a', 'b'],
      ['scout'],
    ]);
    expect(new Set(updates.map((update) => update.id)).size).toBe(2);
    updates.forEach((update) =>
      expect(update.id.startsWith(SERIES_UID)).toBe(true)
    );
  });

  it('reports the id a replan dissolves when two collections merge', () => {
    const { between, straight, tilted } = mergingInstances(slice);

    const [first, second] = registerAll([[straight, tilted], [between]]);

    expect(first.updates).toHaveLength(2);
    expect(second.updates).toHaveLength(1);
    expect(second.updates[0].members).toEqual([straight, tilted, between]);
    expect(second.removed).toEqual(
      first.updates
        .map((update) => update.id)
        .filter((id) => id !== second.updates[0].id)
    );
  });

  it('reports a collection that lost members without gaining an instance', () => {
    const straight = slice({ sop: 'sop-2', z: 0, orientation: tilt(0) });
    const near = slice({ sop: 'sop-3', z: 1, orientation: tilt(0.01) });
    // Agrees with the straight instance but not with the near one, so the
    // bucket it seeds as the new reference leaves the near one behind.
    const splitter = slice({ sop: 'sop-1', z: 2, orientation: tilt(-0.005) });

    const [first, second] = registerAll([[straight, near], [splitter]]);

    expect(first.updates).toHaveLength(1);
    const orphaned = second.updates.find(
      (update) => !update.members.includes(splitter)
    )!;
    expect(sopsOf(orphaned.members)).toEqual(['sop-3']);
    expect(second.removed).toEqual([first.updates[0].id]);
  });

  it('keeps the members a replan moved when the dissolved id is forgotten', () => {
    const { between, straight, tilted } = mergingInstances(slice);

    const [, merged] = registerAll([[straight, tilted], [between]]);
    const state = merged.removed.reduce(forgetCollection, merged.state);
    const third = registerInstances(state, [between]);

    expect(third.updates[0].members).toHaveLength(3);
  });

  it('says how each collection differs from what was committed', () => {
    const [a, b] = [0, 1].map((z) => slice({ sop: `c${z}`, z }));

    const changes = registerAll([[a], [slice({ sop: 'c0', z: 0 })], [b]]).map(
      ({ updates }) => updates.map((update) => update.unchanged)
    );

    expect(changes).toEqual([[false], [true], [false]]);
  });

  it('reports a collection a sibling relabelled without calling its volume changed', () => {
    const [first, second] = registerAll([
      acquisition('1', [0, 2]),
      acquisition('2', [1, 3]),
    ]);

    expect(first.updates[0].collection.label).toBeNull();
    expect(
      second.updates.map(({ id, unchanged, collection }) => [
        id === first.updates[0].id,
        unchanged,
        collection.label,
      ])
    ).toEqual([
      [true, true, 'acquisition 1'],
      [false, false, 'acquisition 2'],
    ]);
    expect(second.removed).toEqual([]);
  });

  it('reports a collection whose label another pixel shape changed, and leaves an untouched one out', () => {
    const scout = slice({ sop: 'scout', rows: '8' });

    const [first, second, third] = registerAll([
      acquisition('1', [0, 2]),
      [scout],
      acquisition('2', [1, 3]),
    ]);

    expect(
      second.updates
        .map(({ members, unchanged, collection }) => [
          sopsOf(members),
          unchanged,
          collection.label,
        ])
        .sort()
    ).toEqual([
      [['1-0', '1-2'], true, 'rows 4'],
      [['scout'], false, 'rows 8'],
    ]);
    expect(
      third.updates.map((update) => sopsOf(update.members))
    ).not.toContainEqual(['scout']);
    const relabelled = third.updates.find(
      (update) => update.id === first.updates[0].id
    )!;
    expect(sopsOf(relabelled.members)).toEqual(['1-0', '1-2']);
    expect(relabelled.collection.label).toBe('rows 4, acquisition 1');
    expect(third.removed).toEqual([]);
  });

  // The positions of the two passes already earned their separation; a later
  // slice nothing spatial can be said about must not dissolve it.
  it('keeps two separated acquisitions when a positionless instance arrives later', () => {
    const passes = [
      ...acquisition('1', [0, 2, 4]),
      ...acquisition('2', [1, 3, 5]),
    ];
    const blind = slice({ sop: 'blind', z: null, instanceNumber: 9 });

    const [separated, later, again] = registerAll([passes, [blind], passes]);

    expect(separated.updates).toHaveLength(2);
    expect(later.removed).toEqual([]);
    expect(later.updates.map((update) => sopsOf(update.members))).toEqual([
      ['blind'],
    ]);
    expect(
      again.updates.map(({ id, members, unchanged }) => [
        id,
        members,
        unchanged,
      ])
    ).toEqual(separated.updates.map(({ id, members }) => [id, members, true]));
  });

  it('reports a collection whose axes a sibling pass outvoted as changed', () => {
    // Within the orientation tolerance, so one bucket, but leaning the normal.
    const tilted = '1\\0\\0\\0\\0.99995\\0.0099998';

    const [first, second] = registerAll([
      [...acquisition('1', [0, 2]), ...acquisition('2', [1, 3], tilted)],
      acquisition('2', [5], tilted),
    ]);

    const before = first.updates.find((update) =>
      sopsOf(update.members).includes('1-0')
    )!;
    const after = second.updates.find((update) => update.id === before.id)!;
    expect(sopsOf(after.members)).toEqual(['1-0', '1-2']);
    expect(after.collection.key).toEqual(before.collection.key);
    expect(after.collection.orientation).not.toEqual(
      before.collection.orientation
    );
    expect(after.unchanged).toBe(false);
  });

  it('plans series independently', () => {
    const first = slice({ sop: 'a', series: SERIES_UID });
    const second = slice({ sop: 'b', series: OTHER_SERIES_UID });

    const updates = lastUpdates([[first, second]]);

    expect(updates.map((update) => update.members)).toEqual([
      [first],
      [second],
    ]);
  });

  it('leaves the input state untouched, so discarding a result undoes it', () => {
    const kept = slice({ sop: 'a', z: 0 });
    const { state } = registerInstances(emptyRegistry, [kept]);

    registerInstances(state, [slice({ sop: 'b', z: 1 })]);
    const retried = slice({ sop: 'b', z: 1 });
    const { updates } = registerInstances(state, [retried]);

    expect(updates[0].members).toHaveLength(2);
    expect(updates[0].members[0]).toBe(kept);
    expect(updates[0].members[1]).toBe(retried);
  });

  it('forgets a collection so a re-import plans it afresh under the same id', () => {
    const scout = slice({ sop: 'scout', rows: '8' });
    const kept = slice({ sop: 'kept' });
    const { state, updates } = registerInstances(emptyRegistry, [scout, kept]);
    const scoutId = updates.find((update) => update.members[0] === scout)!.id;

    const forgotten = forgetCollection(state, scoutId);
    const resupplied = slice({ sop: 'scout', rows: '8' });
    const again = registerInstances(forgotten, [
      resupplied,
      slice({ sop: 'kept' }),
    ]);

    // Identity, not shape: the forgotten instance is an equal but stale object.
    const membersOf = (sop: string) =>
      again.updates.find((update) => sopsOf(update.members)[0] === sop)!
        .members;
    expect(membersOf('scout')).toHaveLength(1);
    expect(membersOf('scout')[0]).toBe(resupplied);
    expect(membersOf('kept')[0]).toBe(kept);
    expect(again.updates.map((update) => update.id)).toContain(scoutId);
    expect(again.removed).toEqual([]);
    expect(forgetCollection(forgotten, 'unknown')).toBe(forgotten);
  });

  it('drops an emptied series from the state', () => {
    const only = slice();
    const { state, updates } = registerInstances(emptyRegistry, [only]);
    const forgotten = forgetCollection(state, updates[0].id);
    expect(forgotten.size).toBe(0);
  });
});
