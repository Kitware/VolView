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
  type RegistryState,
} from '../instanceRegistry';
import { mergingInstances } from '@/tests/dicomOrientationFixtures';
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
    expect(second.updates[0].members).toEqual([original]);
    expect(second.updates[0].provenance).toEqual([resupplied]);
    expect(isRegistered(second.state, original)).toBe(true);
    expect(isRegistered(second.state, resupplied)).toBe(false);
  });

  it('reports a conflicting copy under a registered UID and keeps the first', () => {
    const original = slice({ sop: 'same', z: 0 });
    const conflicting = slice({ sop: 'same', z: 1 });

    const second = registerAll([[original], [conflicting]])[1];

    expect(second.conflictingInstanceUids).toEqual(['same']);
    expect(second.updates[0].members).toEqual([original]);
    expect(second.updates[0].provenance).toEqual([original]);
  });

  it('identifies instances without a UID by object', () => {
    const first = slice({ sop: null, z: 0 });
    const second = slice({ sop: null, z: 1 });

    const results = registerAll([[first, second, first], [first]]);

    expect(results[0].updates[0].members).toEqual([first, second]);
    expect(results[1].updates[0].members).toEqual([first, second]);
  });

  it('recognizes a NUL padded UID as the registered instance', () => {
    const padded = slice({ sop: '1.2.3\0\0' });
    const { state } = registerInstances(emptyRegistry, [padded]);
    expect(isRegistered(state, padded)).toBe(true);
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

  it('leaves an untouched collection out and reports a relabelled one', () => {
    const scout = slice({ sop: 'scout', rows: '8' });
    const acquisition = (number: string, zs: number[]) =>
      zs.map((z) =>
        slice({
          sop: `${number}-${z}`,
          z,
          tags: { [Tags.AcquisitionNumber]: number },
        })
      );

    const [first, second, third] = registerAll([
      acquisition('1', [0, 2]),
      [scout],
      acquisition('2', [1, 3]),
    ]);

    expect(second.updates.map((update) => sopsOf(update.members))).toEqual([
      ['scout'],
    ]);
    const relabelled = third.updates.find(
      (update) => update.id === first.updates[0].id
    )!;
    expect(sopsOf(relabelled.members)).toEqual(['1-0', '1-2']);
    expect(relabelled.collection.label).toBe('rows 4, acquisition 1');
    expect(third.removed).toEqual([]);
  });

  it('says how each collection differs from what was committed', () => {
    const [a, b] = [0, 1].map((z) => slice({ sop: `c${z}`, z }));

    const changes = registerAll([[a], [slice({ sop: 'c0', z: 0 })], [b]]).map(
      ({ updates }) => updates.map((update) => update.change)
    );

    expect(changes).toEqual([['new'], ['unchanged'], ['changed']]);
  });

  it('reports a relabelled collection as changed', () => {
    const acquisition = (number: string, zs: number[]) =>
      zs.map((z) =>
        slice({
          sop: `${number}-${z}`,
          z,
          tags: { [Tags.AcquisitionNumber]: number },
        })
      );

    const [, second] = registerAll([
      acquisition('1', [0, 2]),
      acquisition('2', [1, 3]),
    ]);

    expect(second.updates.map((update) => update.change)).toEqual([
      'changed',
      'new',
    ]);
  });

  it('reports a collection whose axes a sibling pass outvoted as changed', () => {
    // Within the orientation tolerance, so one bucket, but leaning the normal.
    const tilted = '1\\0\\0\\0\\0.99995\\0.0099998';
    const acquisition = (number: string, zs: number[], orientation?: string) =>
      zs.map((z) =>
        slice({
          sop: `${number}-${z}`,
          z,
          orientation,
          tags: { [Tags.AcquisitionNumber]: number },
        })
      );

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
    expect(after.change).toBe('changed');
  });

  it.each(['SEG', 'SEG\u0000'])(
    'reports SEG modality %j as a segmentation collection',
    (modality) => {
      const [image, seg] = lastUpdates([
        [slice({ sop: 'image' }), slice({ sop: 'seg', modality, rows: '8' })],
      ]);

      expect([image.kind, seg.kind]).toEqual(['image', 'segmentation']);
    }
  );

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
    const discarded = slice({ sop: 'b', z: 1 });

    registerInstances(state, [discarded]);
    const retried = slice({ sop: 'b', z: 1 });
    const { updates } = registerInstances(state, [retried]);

    expect(isRegistered(state, discarded)).toBe(false);
    expect(updates[0].members).toEqual([kept, retried]);
  });

  it('forgets a collection so a re-import plans it afresh under the same id', () => {
    const scout = slice({ sop: 'scout', rows: '8' });
    const kept = slice({ sop: 'kept' });
    const { state, updates } = registerInstances(emptyRegistry, [scout, kept]);
    const scoutId = updates.find((update) => update.members[0] === scout)!.id;

    const forgotten = forgetCollection(state, scoutId);
    const resupplied = slice({ sop: 'scout', rows: '8' });
    const again = registerInstances(forgotten, [resupplied]);

    expect(isRegistered(forgotten, scout)).toBe(false);
    expect(isRegistered(forgotten, kept)).toBe(true);
    expect(again.updates.map((update) => [update.id, update.members])).toEqual([
      [scoutId, [resupplied]],
    ]);
    expect(again.removed).toEqual([]);
    expect(forgetCollection(forgotten, 'unknown')).toBe(forgotten);
  });

  it('drops an emptied series from the state', () => {
    const only = slice();
    const { state, updates } = registerInstances(emptyRegistry, [only]);
    const forgotten: RegistryState = forgetCollection(state, updates[0].id);
    expect(forgotten.size).toBe(0);
  });
});
