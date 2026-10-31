import { describe, it, expect } from 'vitest';
import {
  HARD_FACT_RULES,
  ORIENTATION_RULE,
  ORIENTATION_TOLERANCE,
  IN_PLANE_SHIFT_WARNING,
  NONPARALLEL_SLICES_WARNING,
  IRREGULAR_VOLUME_WARNING,
  REPEATED_POSITIONS_WARNING,
  UNREADABLE_POSITION_WARNING,
  planDicomCollections,
  validateCollections,
} from '../planDicomCollections';
import { SEMANTIC_AXES } from '../splitOverlappingAcquisitions';
import type { DicomCollection, InstanceFacts } from '../planDicomCollections';
import {
  IDENTITY_ORIENTATION,
  clone,
  makeFacts,
  orientationKeyValue,
  tiltedOrientation,
} from './instanceFactsFixture';

const SERIES_KEY = 'series-1';

const plan = (instances: InstanceFacts[], seriesKey = SERIES_KEY) =>
  planDicomCollections({ seriesKey, instances });

const uidsOf = (collection: DicomCollection) =>
  collection.members.map((m) => m.sopInstanceUid);

function collectionWith(collections: DicomCollection[], uid: string) {
  const found = collections.find((c) =>
    c.members.some((m) => m.sopInstanceUid === uid)
  );
  if (!found) throw new Error(`no collection holds ${uid}`);
  return found;
}

const partValue = (collection: DicomCollection, rule: string) => {
  const part = collection.key.parts.find(([name]) => name === rule);
  if (!part) throw new Error(`no key part named ${rule}`);
  return part[1];
};

const mentions = (diagnostics: string[], needle: string) =>
  diagnostics.some((d) => d.includes(needle));

// Second orientation row rotations, measured against the dot-product tolerance.
const WITHIN = Math.acos(1 - ORIENTATION_TOLERANCE / 2);
const BEYOND = Math.acos(1 - ORIENTATION_TOLERANCE * 2);
// cos(CHAIN) is inside the tolerance while cos(2 * CHAIN) is outside it.
const CHAIN = Math.sqrt(ORIENTATION_TOLERANCE);

describe('planDicomCollections', () => {
  it('plans nothing for an empty instance list', () => {
    expect(plan([])).toEqual({ collections: [] });
  });

  it('keeps one consistent series in a single collection', () => {
    const a = makeFacts('uid-a', { projectedPosition: 0, instanceNumber: 1 });
    const b = makeFacts('uid-b', { projectedPosition: 1, instanceNumber: 2 });

    const { collections } = plan([a, b]);

    expect(collections).toHaveLength(1);
    expect(collections[0].key.seriesKey).toBe(SERIES_KEY);
    expect(collections[0].members[0]).toBe(a);
    expect(collections[0].members[1]).toBe(b);
    expect(collections[0].order).toBe('spatial');
    expect(collections[0].diagnostics).toEqual([]);
  });

  it('names the hard facts then orientation, in a fixed key order', () => {
    const { collections } = plan([makeFacts('uid-a')]);

    expect(collections[0].key.parts.map(([rule]) => rule)).toEqual([
      ...HARD_FACT_RULES,
      ORIENTATION_RULE,
      ...SEMANTIC_AXES.map((axis) => axis.rule),
    ]);
    expect(collections[0].key.parts).toEqual([
      ['seriesNumber', '1'],
      ['sequenceName', null],
      ['sliceThickness', '1'],
      ['seriesDate', '20240101'],
      ['rows', '4'],
      ['columns', '4'],
      ['samplesPerPixel', '1'],
      ['numberOfFrames', null],
      ['orientation', orientationKeyValue(IDENTITY_ORIENTATION)],
      ['acquisition', null],
      ['phase', null],
      ['echo', null],
      ['b-value', null],
    ]);
  });

  const differingFacts: Array<[string, Partial<InstanceFacts>, string]> = [
    ['seriesNumber', { seriesNumber: '2' }, '2'],
    ['sequenceName', { sequenceName: 'SEQ' }, 'SEQ'],
    ['sliceThickness', { sliceThickness: '5' }, '5'],
    ['seriesDate', { seriesDate: '20240102' }, '20240102'],
    ['rows', { rows: '8' }, '8'],
    ['columns', { columns: '8' }, '8'],
    ['samplesPerPixel', { samplesPerPixel: '3' }, '3'],
    ['numberOfFrames', { numberOfFrames: '2' }, '2'],
  ];

  it.each(differingFacts)(
    'partitions on a differing %s',
    (rule, overrides, expected) => {
      const a = makeFacts('uid-a');
      const b = makeFacts('uid-b', overrides);

      const { collections } = plan([a, b]);

      expect(collections).toHaveLength(2);
      expect(uidsOf(collectionWith(collections, 'uid-a'))).toEqual(['uid-a']);
      expect(uidsOf(collectionWith(collections, 'uid-b'))).toEqual(['uid-b']);
      expect(partValue(collectionWith(collections, 'uid-b'), rule)).toBe(
        expected
      );
    }
  );

  const missingFacts: Array<
    [string, Partial<InstanceFacts>, Partial<InstanceFacts>]
  > = [
    ['seriesNumber', { seriesNumber: '1' }, { seriesNumber: null }],
    ['sequenceName', { sequenceName: 'SEQ' }, { sequenceName: null }],
    ['sliceThickness', { sliceThickness: '1' }, { sliceThickness: null }],
    ['seriesDate', { seriesDate: '20240101' }, { seriesDate: null }],
    ['rows', { rows: '4' }, { rows: null }],
    ['columns', { columns: '4' }, { columns: null }],
    ['samplesPerPixel', { samplesPerPixel: '1' }, { samplesPerPixel: null }],
    ['numberOfFrames', { numberOfFrames: '2' }, { numberOfFrames: null }],
  ];

  it.each(missingFacts)(
    'buckets a missing %s on its own',
    (rule, present, absent) => {
      const a = makeFacts('uid-a', present);
      const b = makeFacts('uid-b', absent);

      const { collections } = plan([a, b]);

      expect(collections).toHaveLength(2);
      expect(partValue(collectionWith(collections, 'uid-b'), rule)).toBeNull();
      expect(
        partValue(collectionWith(collections, 'uid-a'), rule)
      ).not.toBeNull();
    }
  );

  it('does not partition on pixel spacing, position or instance number', () => {
    const a = makeFacts('uid-a', {
      pixelSpacing: [1, 1],
      position: [0, 0, 0],
      projectedPosition: 0,
      instanceNumber: 1,
    });
    const b = makeFacts('uid-b', {
      pixelSpacing: [0.5, 0.75],
      position: [0, 0, 3],
      projectedPosition: 3,
      instanceNumber: 9,
    });

    const { collections } = plan([a, b]);

    expect(collections).toHaveLength(1);
    expect(uidsOf(collections[0])).toEqual(['uid-a', 'uid-b']);
  });

  it('keys on the given series key, not the instances own series UID', () => {
    const a = makeFacts('uid-a', { seriesInstanceUid: 'somewhere-else' });

    const { collections } = plan([a], 'series-9');

    expect(collections[0].key.seriesKey).toBe('series-9');
  });

  it('buckets orientations whose rows agree within the tolerance', () => {
    const a = makeFacts('uid-a', { orientation: IDENTITY_ORIENTATION });
    const b = makeFacts('uid-b', { orientation: tiltedOrientation(WITHIN) });

    const { collections } = plan([a, b]);

    expect(collections).toHaveLength(1);
    expect(uidsOf(collections[0])).toEqual(['uid-a', 'uid-b']);
  });

  it('splits orientations whose rows disagree beyond the tolerance', () => {
    const a = makeFacts('uid-a', { orientation: IDENTITY_ORIENTATION });
    const b = makeFacts('uid-b', { orientation: tiltedOrientation(BEYOND) });

    const { collections } = plan([a, b]);

    expect(collections).toHaveLength(2);
    expect(
      partValue(collectionWith(collections, 'uid-b'), ORIENTATION_RULE)
    ).toBe(orientationKeyValue(tiltedOrientation(BEYOND)));
  });

  it('buckets identical cosines that are slightly over normalized', () => {
    const overNormalized = [1.0001, 0, 0, 0, 1, 0];
    const a = makeFacts('uid-a', { orientation: overNormalized });
    const b = makeFacts('uid-b', { orientation: overNormalized });

    const { collections } = plan([a, b]);

    expect(collections).toHaveLength(1);
    expect(uidsOf(collections[0])).toEqual(['uid-a', 'uid-b']);
    expect(partValue(collections[0], ORIENTATION_RULE)).toBe(
      orientationKeyValue(overNormalized)
    );
  });

  it('buckets a chain of near orientations the same way under permutation', () => {
    const a = makeFacts('uid-a', { orientation: IDENTITY_ORIENTATION });
    const b = makeFacts('uid-b', { orientation: tiltedOrientation(CHAIN) });
    const c = makeFacts('uid-c', { orientation: tiltedOrientation(2 * CHAIN) });

    const forward = plan([a, b, c]);
    const backward = plan([c, b, a]);
    const shuffled = plan([b, c, a]);

    expect(forward.collections).toHaveLength(2);
    expect(uidsOf(collectionWith(forward.collections, 'uid-a'))).toEqual([
      'uid-a',
      'uid-b',
    ]);
    expect(uidsOf(collectionWith(forward.collections, 'uid-c'))).toEqual([
      'uid-c',
    ]);
    expect(backward).toEqual(forward);
    expect(shuffled).toEqual(forward);
  });

  it('buckets a chain of anonymous near orientations the same under permutation', () => {
    const anonymousChain = () => [
      makeFacts(null, {
        orientation: IDENTITY_ORIENTATION,
        projectedPosition: 0,
      }),
      makeFacts(null, {
        orientation: tiltedOrientation(CHAIN),
        projectedPosition: 1,
      }),
      makeFacts(null, {
        orientation: tiltedOrientation(2 * CHAIN),
        projectedPosition: 2,
      }),
    ];

    const [x, y, z] = anonymousChain();
    const forward = plan([x, y, z]);

    expect(forward.collections.map((c) => c.members.length)).toEqual([2, 1]);
    expect(plan([z, y, x])).toEqual(forward);
    expect(plan([y, x, z])).toEqual(forward);
  });

  it('takes the orientation key from the smallest SOP UID, not the first input', () => {
    const late = makeFacts('uid-z', { orientation: IDENTITY_ORIENTATION });
    const early = makeFacts('uid-a', {
      orientation: tiltedOrientation(WITHIN),
    });

    const { collections } = plan([late, early]);

    expect(collections).toHaveLength(1);
    expect(partValue(collections[0], ORIENTATION_RULE)).toBe(
      orientationKeyValue(tiltedOrientation(WITHIN))
    );
  });

  it('never represents a bucket with an instance that has no SOP UID', () => {
    const anonymous = makeFacts(null, { orientation: IDENTITY_ORIENTATION });
    const identified = makeFacts('uid-z', {
      orientation: tiltedOrientation(WITHIN),
    });

    const { collections } = plan([anonymous, identified]);

    expect(collections).toHaveLength(1);
    expect(partValue(collections[0], ORIENTATION_RULE)).toBe(
      orientationKeyValue(tiltedOrientation(WITHIN))
    );
  });

  it('buckets an unreadable orientation on its own and diagnoses it', () => {
    const a = makeFacts('uid-a');
    const b = makeFacts('uid-b', { orientation: null });

    const { collections } = plan([a, b]);

    expect(collections).toHaveLength(2);
    const orphan = collectionWith(collections, 'uid-b');
    expect(partValue(orphan, ORIENTATION_RULE)).toBeNull();
    expect(mentions(orphan.diagnostics, 'uid-b')).toBe(true);
  });

  it('deduplicates by SOP Instance UID, keeping the last occurrence', () => {
    const stale = makeFacts('uid-a', { instanceNumber: 1 });
    const fresh = makeFacts('uid-a', { instanceNumber: 7 });

    const { collections } = plan([stale, fresh]);

    expect(collections).toHaveLength(1);
    expect(collections[0].members).toHaveLength(1);
    expect(collections[0].members[0]).toBe(fresh);
    expect(mentions(collections[0].diagnostics, 'uid-a')).toBe(true);
  });

  it('never merges instances that have no SOP Instance UID', () => {
    const a = makeFacts(null, { projectedPosition: 0, instanceNumber: 1 });
    const b = makeFacts(null, { projectedPosition: 1, instanceNumber: 2 });

    const { collections } = plan([a, b]);

    expect(collections).toHaveLength(1);
    expect(collections[0].members).toHaveLength(2);
  });

  it('keeps both entries when one anonymous instance is listed twice', () => {
    const shared = makeFacts(null);

    const { collections } = plan([shared, shared]);

    expect(collections).toHaveLength(1);
    expect(collections[0].members).toEqual([shared, shared]);
  });

  it('orders members by projected position ascending', () => {
    const high = makeFacts('uid-a', { projectedPosition: 10 });
    const low = makeFacts('uid-b', { projectedPosition: -5 });
    const mid = makeFacts('uid-c', { projectedPosition: 0 });

    const { collections } = plan([high, low, mid]);

    expect(uidsOf(collections[0])).toEqual(['uid-b', 'uid-c', 'uid-a']);
    expect(collections[0].order).toBe('spatial');
    expect(collections[0].diagnostics).toEqual([]);
  });

  // The tied members keep the scanner's own sequence, but position stays the
  // primary key: slot i lands at origin + i * spacing along the normal, so an
  // order that ran against position would mirror the volume.
  it('breaks a repeated projected position on instance number, keeping spatial order', () => {
    const later = makeFacts('uid-a', {
      projectedPosition: 3,
      instanceNumber: 2,
    });
    const earlier = makeFacts('uid-b', {
      projectedPosition: 3,
      instanceNumber: 1,
    });
    // Numbered before the tied pair yet positioned after it.
    const far = makeFacts('uid-c', { projectedPosition: 5, instanceNumber: 0 });
    const near = makeFacts('uid-d', {
      projectedPosition: 0,
      instanceNumber: 9,
    });

    const { collections } = plan([later, far, earlier, near]);

    expect(uidsOf(collections[0])).toEqual([
      'uid-d',
      'uid-b',
      'uid-a',
      'uid-c',
    ]);
    expect(collections[0].order).toBe('spatial');
    expect(collections[0].warnings).toEqual([REPEATED_POSITIONS_WARNING]);
  });

  it('breaks a repeated position on SOP Instance UID when instance numbers tie', () => {
    const second = makeFacts('uid-b', { projectedPosition: 3 });
    const first = makeFacts('uid-a', { projectedPosition: 3 });

    const { collections } = plan([second, first]);

    expect(uidsOf(collections[0])).toEqual(['uid-a', 'uid-b']);
    expect(collections[0].order).toBe('spatial');
  });

  it('orders an unnumbered member after a numbered one at the same position', () => {
    const numbered = makeFacts('uid-b', { projectedPosition: 3 });
    const unnumbered = makeFacts('uid-a', {
      projectedPosition: 3,
      instanceNumber: null,
    });
    const low = makeFacts('uid-c', { projectedPosition: 0 });

    const { collections } = plan([unnumbered, numbered, low]);

    expect(uidsOf(collections[0])).toEqual(['uid-c', 'uid-b', 'uid-a']);
    expect(collections[0].order).toBe('spatial');
  });

  it('breaks a shared position between anonymous members on content', () => {
    const anonymousPair = () => [
      makeFacts(null, { projectedPosition: 0, instanceNumber: 1 }),
      makeFacts(null, { projectedPosition: 0, instanceNumber: 2 }),
    ];

    const [a, b] = anonymousPair();
    const forward = plan([a, b]);

    expect(forward.collections[0].members.map((m) => m.instanceNumber)).toEqual(
      [1, 2]
    );
    expect(plan([b, a])).toEqual(forward);
  });

  it('breaks an anonymous tie on facts outside the ordering keys', () => {
    const anonymousPair = () => [
      makeFacts(null, { position: [0, 0, 0] }),
      makeFacts(null, { position: [9, 9, 9] }),
    ];

    const [a, b] = anonymousPair();
    const forward = plan([a, b]);

    expect(forward.collections[0].members.map((m) => m.position)).toEqual([
      [0, 0, 0],
      [9, 9, 9],
    ]);
    expect(plan([b, a])).toEqual(forward);
  });

  it('keeps an unreadable position out of the collection it cannot be placed in', () => {
    const blind = makeFacts('uid-a', {
      projectedPosition: null,
      instanceNumber: 3,
    });
    const alsoBlind = makeFacts('uid-c', {
      projectedPosition: null,
      instanceNumber: 1,
    });
    const seen = makeFacts('uid-b', {
      projectedPosition: 2,
      instanceNumber: 1,
    });

    const { collections } = plan([blind, seen, alsoBlind]);

    expect(collections).toHaveLength(2);
    expect(uidsOf(collectionWith(collections, 'uid-b'))).toEqual(['uid-b']);

    const unknown = collectionWith(collections, 'uid-a');
    expect(uidsOf(unknown)).toEqual(['uid-c', 'uid-a']);
    expect(unknown.order).toBe('instance-number');
    expect(mentions(unknown.diagnostics, 'uid-a')).toBe(true);
    expect(unknown.warnings).toEqual([UNREADABLE_POSITION_WARNING]);
  });

  it('says nothing about a series that is one positionless instance', () => {
    const alone = makeFacts('uid-a', {
      projectedPosition: null,
      instanceNumber: 1,
    });

    const { collections } = plan([alone]);

    expect(collections).toHaveLength(1);
    expect(collections[0].warnings).toEqual([]);
  });

  it('warns about a lone positionless instance beside a volume it missed', () => {
    const alone = makeFacts('uid-a', {
      projectedPosition: null,
      instanceNumber: 1,
    });
    const seen = makeFacts('uid-b', {
      projectedPosition: 2,
      instanceNumber: 2,
    });

    const { collections } = plan([alone, seen]);

    expect(collectionWith(collections, 'uid-a').warnings).toEqual([
      UNREADABLE_POSITION_WARNING,
    ]);
  });

  it('breaks a shared instance number on SOP Instance UID', () => {
    const second = makeFacts('uid-b', {
      projectedPosition: null,
      instanceNumber: 4,
    });
    const first = makeFacts('uid-a', {
      projectedPosition: null,
      instanceNumber: 4,
    });

    const { collections } = plan([second, first]);

    expect(uidsOf(collections[0])).toEqual(['uid-a', 'uid-b']);
    expect(collections[0].order).toBe('instance-number');
  });

  it('records input order when neither position nor instance number reads', () => {
    const second = makeFacts('uid-b', {
      projectedPosition: null,
      instanceNumber: null,
    });
    const first = makeFacts('uid-a', {
      projectedPosition: null,
      instanceNumber: null,
    });

    const { collections } = plan([second, first]);

    expect(uidsOf(collections[0])).toEqual(['uid-b', 'uid-a']);
    expect(collections[0].order).toBe('input');
    expect(mentions(collections[0].diagnostics, 'uid-a')).toBe(true);
    expect(mentions(collections[0].diagnostics, 'uid-b')).toBe(true);
  });

  const permutable = () => [
    makeFacts('uid-1', { projectedPosition: 2, instanceNumber: 2 }),
    makeFacts('uid-2', { projectedPosition: 1, instanceNumber: 1 }),
    makeFacts('uid-3', {
      projectedPosition: 0,
      instanceNumber: 3,
      sliceThickness: '5',
    }),
    makeFacts('uid-4', {
      projectedPosition: 4,
      instanceNumber: 4,
      sliceThickness: '5',
    }),
    makeFacts('uid-5', {
      projectedPosition: 3,
      instanceNumber: 5,
      orientation: tiltedOrientation(BEYOND),
    }),
    makeFacts('uid-6', {
      projectedPosition: 5,
      instanceNumber: 6,
      orientation: tiltedOrientation(BEYOND),
    }),
  ];

  it('is invariant to input permutation in membership and order', () => {
    const base = plan(permutable());
    const reversed = plan(permutable().reverse());
    const rotated = (() => {
      const items = permutable();
      return plan([...items.slice(2), ...items.slice(0, 2)]);
    })();
    const interleaved = (() => {
      const items = permutable();
      return plan([items[5], items[0], items[3], items[1], items[4], items[2]]);
    })();

    expect(base.collections).toHaveLength(3);
    expect(reversed).toEqual(base);
    expect(rotated).toEqual(base);
    expect(interleaved).toEqual(base);
  });

  it('does not mutate the instances it is given', () => {
    const instances = permutable();
    const before = clone(instances);

    plan(instances);

    expect(clone(instances)).toEqual(before);
  });

  it('holds every instance exactly once across the collections', () => {
    const instances = permutable();

    const { collections } = plan(instances);
    const members = collections.flatMap((c) => c.members);

    expect(members).toHaveLength(instances.length);
    expect(new Set(members).size).toBe(instances.length);
    instances.forEach((instance) => expect(members).toContain(instance));
    expect(() => validateCollections(instances, collections)).not.toThrow();
  });
});

describe('planDicomCollections semantic partition', () => {
  const pass = (acquisition: string, zs: number[]) =>
    zs.map((z, i) =>
      makeFacts(`acq${acquisition}-${i}`, {
        projectedPosition: z,
        instanceNumber: i + 1,
        acquisitionNumber: acquisition,
      })
    );

  it('separates overlapping passes and labels each collection', () => {
    const first = pass('1', [0, 2, 4]);
    const second = pass('2', [1, 3, 5]);

    const { collections } = plan([...first, ...second]);

    expect(collections).toHaveLength(2);
    const [one, two] = collections;
    expect(one.label).toBe('acquisition 1');
    expect(partValue(one, 'acquisition')).toBe('1');
    expect(uidsOf(one)).toEqual(['acq1-0', 'acq1-1', 'acq1-2']);
    expect(one.order).toBe('spatial');
    expect(two.label).toBe('acquisition 2');
    expect(partValue(two, 'acquisition')).toBe('2');
    expect(collections.every((c) => c.warnings.length === 0)).toBe(true);
  });

  // Two members whose cosines agree within the tolerance are one plane. Each
  // member's own normal would place them at two positions a fraction of a
  // micron apart, and the repeated slice would go unreported.
  it('projects a bucket on one normal rather than on each member of it', () => {
    const straight = makeFacts('uid-a', {
      position: [0, 0, 10],
      projectedPosition: 10,
    });
    const tilted = makeFacts('uid-b', {
      orientation: tiltedOrientation(WITHIN),
      position: [0, 0, 10],
      projectedPosition: 10 * Math.cos(WITHIN),
    });

    const { collections } = plan([straight, tilted]);

    expect(collections).toHaveLength(1);
    expect(collections[0].warnings).toEqual([REPEATED_POSITIONS_WARNING]);
  });

  it('partitions each orientation bucket on its own', () => {
    const stack = [...pass('1', [0, 2]), ...pass('2', [1, 3])];
    const scout = makeFacts('scout', {
      orientation: tiltedOrientation(BEYOND),
      acquisitionNumber: '1',
    });

    const { collections } = plan([...stack, scout]);

    expect(collections).toHaveLength(3);
    expect(collectionWith(collections, 'scout').label).toBeNull();
    expect(collectionWith(collections, 'acq1-0').label).toBe('acquisition 1');
  });

  it('leaves an unlabelled collection when nothing overlaps', () => {
    const { collections } = plan(pass('1', [0, 2, 4]));

    expect(collections[0].label).toBeNull();
    expect(partValue(collections[0], 'acquisition')).toBeNull();
    expect(collections[0].warnings).toEqual([]);
  });

  it('warns that an unevenly spaced collection is not one regular volume', () => {
    // Two 4mm runs with a gap between them, as the bilateral sagittal slabs
    // of idcSeriesFixtures.ts are. One collection, but no single lattice.
    const { collections } = plan(pass('1', [0, 4, 8, 50, 54, 58]));

    expect(collections).toHaveLength(1);
    expect(collections[0].warnings).toEqual([IRREGULAR_VOLUME_WARNING]);
  });

  it('leaves an evenly spaced collection unwarned', () => {
    const { collections } = plan(pass('1', [0, 4, 8, 12]));

    expect(collections[0].warnings).toEqual([]);
  });

  it('warns that a tilted gantry stack was stacked without correcting its shear', () => {
    const theta = Math.PI / 9;
    const orientation = tiltedOrientation(theta);
    // The table advances along z while the columns lean into it, so each
    // slice plane sits sideways of the last on the stack's own normal.
    const stack = [0, 3, 6, 9].map((z, i) =>
      makeFacts(`tilt-${i}`, {
        orientation,
        position: [0, 0, z],
        projectedPosition: z * Math.cos(theta),
        instanceNumber: i + 1,
      })
    );

    const { collections } = plan(stack);

    expect(collections).toHaveLength(1);
    expect(collections[0].order).toBe('spatial');
    expect(uidsOf(collections[0])).toEqual(stack.map((m) => m.sopInstanceUid));
    expect(collections[0].warnings).toEqual([IN_PLANE_SHIFT_WARNING]);
  });

  // A 358mm field of view, so a lean shows at the far corner of a slice.
  const wideStack = (strayUid: string, lean: number) =>
    [0, 5, 10, 15].map((z, i) =>
      makeFacts(i === 2 ? strayUid : `wide-${i}`, {
        rows: '512',
        columns: '512',
        pixelSpacing: [0.7, 0.7],
        orientation: i === 2 ? tiltedOrientation(lean) : IDENTITY_ORIENTATION,
        projectedPosition: z,
        instanceNumber: i + 1,
      })
    );

  it.each(['a-walked-first', 'z-walked-last'])(
    'takes the axes most slices declare when the stray one is %s',
    (strayUid) => {
      const { collections } = plan(wideStack(strayUid, 0.0002));

      expect(collections).toHaveLength(1);
      expect(collections[0].orientation).toEqual(IDENTITY_ORIENTATION);
      expect(collections[0].warnings).toEqual([]);
    }
  );

  it('warns when a slice leans off the volume axes by more than a tenth of a millimetre', () => {
    const { collections } = plan(wideStack('wide-stray', 0.001));

    expect(collections).toHaveLength(1);
    expect(collections[0].orientation).toEqual(IDENTITY_ORIENTATION);
    expect(collections[0].warnings).toEqual([NONPARALLEL_SLICES_WARNING]);
  });

  it('warns about a repeated position no axis separates', () => {
    const { collections } = plan(pass('1', [0, 2, 2, 4]));

    expect(collections).toHaveLength(1);
    expect(collections[0].warnings).toEqual([REPEATED_POSITIONS_WARNING]);
  });

  // A later import can bring a slice whose geometry cannot be read. Merging it
  // back in would undo a separation the positions of the other members
  // already earned.
  it('keeps two separated acquisitions apart when a positionless member arrives', () => {
    const first = pass('1', [0, 2, 4]);
    const second = pass('2', [1, 3, 5]);
    const before = plan([...first, ...second]);

    const blind = makeFacts('blind', {
      projectedPosition: null,
      position: null,
      instanceNumber: 7,
    });
    const after = plan([...first, ...second, blind]);

    expect(before.collections).toHaveLength(2);
    expect(after.collections).toHaveLength(3);

    // The two evidence-backed collections survive unchanged, keys included.
    before.collections.forEach((collection) => {
      const kept = collectionWith(
        after.collections,
        collection.members[0].sopInstanceUid!
      );
      expect(kept.key).toEqual(collection.key);
      expect(uidsOf(kept)).toEqual(uidsOf(collection));
      expect(kept.warnings).toEqual([]);
    });

    const unknown = collectionWith(after.collections, 'blind');
    expect(uidsOf(unknown)).toEqual(['blind']);
    expect(unknown.warnings).toEqual([UNREADABLE_POSITION_WARNING]);
    expect(unknown.key).not.toEqual(before.collections[0].key);
  });

  it('gives the two passes distinct, collision-free keys', () => {
    const { collections } = plan([...pass('1', [0, 2]), ...pass('2', [1, 3])]);

    expect(() =>
      validateCollections(
        collections.flatMap((c) => c.members),
        collections
      )
    ).not.toThrow();
  });
});

describe('validateCollections', () => {
  const a = makeFacts('uid-a');
  const b = makeFacts('uid-b');

  const collectionOf = (
    members: InstanceFacts[],
    parts: Array<[string, string | null]>
  ): DicomCollection => ({
    key: { seriesKey: SERIES_KEY, parts },
    members,
    order: 'input',
    reconstruction: {
      kind: 'regular',
      sliceSpacing: null,
      slots: members.map((_, index) => index),
    },
    orientation: null,
    label: null,
    diagnostics: [],
    warnings: [],
  });

  const partsOne: Array<[string, string | null]> = [['orientation', 'one']];
  const partsTwo: Array<[string, string | null]> = [['orientation', 'two']];

  it('accepts a conserving, collision-free plan', () => {
    expect(() =>
      validateCollections(
        [a, b],
        [collectionOf([a], partsOne), collectionOf([b], partsTwo)]
      )
    ).not.toThrow();
  });

  it('rejects an instance that landed in no collection', () => {
    expect(() =>
      validateCollections([a, b], [collectionOf([a], partsOne)])
    ).toThrow('uid-b');
  });

  it('rejects an instance that landed in two collections', () => {
    expect(() =>
      validateCollections(
        [a],
        [collectionOf([a], partsOne), collectionOf([a], partsTwo)]
      )
    ).toThrow('uid-a');
  });

  it('accepts an instance listed twice when it is placed twice', () => {
    expect(() =>
      validateCollections([a, a], [collectionOf([a, a], partsOne)])
    ).not.toThrow();
  });

  it('rejects an instance listed twice but placed once', () => {
    expect(() =>
      validateCollections([a, a], [collectionOf([a], partsOne)])
    ).toThrow('uid-a');
  });

  it('rejects a member that was never one of the instances', () => {
    expect(() =>
      validateCollections([a], [collectionOf([a, b], partsOne)])
    ).toThrow('uid-b');
  });

  it('rejects two collections sharing a key', () => {
    expect(() =>
      validateCollections(
        [a, b],
        [collectionOf([a], partsOne), collectionOf([b], partsOne)]
      )
    ).toThrow(/key/i);
  });
});

describe('independent multi-frame instances', () => {
  it.each([null, 0])(
    'keeps equal-shaped clips separate at position %s',
    (position) => {
      const instances = ['clip-a', 'clip-b'].map((uid) =>
        makeFacts(uid, {
          numberOfFrames: '3',
          position: position === null ? null : [0, 0, position],
          projectedPosition: position,
        })
      );
      const collections = plan(instances).collections;
      expect(collections.map((c) => uidsOf(c))).toEqual([
        ['clip-a'],
        ['clip-b'],
      ]);
      expect(new Set(collections.map((c) => JSON.stringify(c.key))).size).toBe(
        2
      );
      expect(plan([...instances].reverse())).toEqual(plan(instances));
    }
  );
});
