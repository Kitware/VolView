import { describe, it, expect } from 'vitest';
import { ORIENTATION_TOLERANCE } from '../orientation';
import {
  IN_PLANE_SHIFT_WARNING,
  NONPARALLEL_SLICES_WARNING,
  IRREGULAR_VOLUME_WARNING,
  REPEATED_POSITIONS_WARNING,
  UNREADABLE_POSITION_WARNING,
  planDicomCollections,
} from '../planDicomCollections';
import type { DicomCollection, InstanceFacts } from '../planDicomCollections';
import {
  IDENTITY_ORIENTATION,
  clone,
  makeFacts,
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

// Second orientation row rotations, measured against the dot-product tolerance.
const WITHIN = Math.acos(1 - ORIENTATION_TOLERANCE / 2);
const BEYOND = Math.acos(1 - ORIENTATION_TOLERANCE * 2);
// cos(CHAIN) is inside the tolerance while cos(2 * CHAIN) is outside it.
const CHAIN = Math.sqrt(ORIENTATION_TOLERANCE);

describe('planDicomCollections', () => {
  it('plans nothing for an empty instance list', () => {
    expect(plan([])).toEqual([]);
  });

  it('keeps one consistent series in a single collection', () => {
    const a = makeFacts('uid-a', { projectedPosition: 0, instanceNumber: 1 });
    const b = makeFacts('uid-b', { projectedPosition: 1, instanceNumber: 2 });

    const collections = plan([a, b]);

    expect(collections).toHaveLength(1);
    expect(collections[0].members[0]).toBe(a);
    expect(collections[0].members[1]).toBe(b);
    expect(collections[0].label).toBeNull();
    expect(collections[0].warnings).toEqual([]);
  });

  const differingFacts: Array<[string, Partial<InstanceFacts>]> = [
    ['rows', { rows: '8' }],
    ['columns', { columns: '8' }],
    ['samplesPerPixel', { samplesPerPixel: '3' }],
    ['numberOfFrames', { numberOfFrames: '2' }],
    ['rows', { rows: null }],
    ['columns', { columns: null }],
    ['samplesPerPixel', { samplesPerPixel: null }],
  ];

  it.each(differingFacts)(
    'partitions on %s differing as %j',
    (_rule, facts) => {
      const a = makeFacts('uid-a');
      const b = makeFacts('uid-b', facts);

      const collections = plan([a, b]);

      expect(collections).toHaveLength(2);
      expect(uidsOf(collectionWith(collections, 'uid-a'))).toEqual(['uid-a']);
      expect(uidsOf(collectionWith(collections, 'uid-b'))).toEqual(['uid-b']);
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

    const collections = plan([a, b]);

    expect(collections).toHaveLength(1);
    expect(uidsOf(collections[0])).toEqual(['uid-a', 'uid-b']);
  });

  it('buckets orientations whose rows agree within the tolerance', () => {
    const a = makeFacts('uid-a', { orientation: IDENTITY_ORIENTATION });
    const b = makeFacts('uid-b', { orientation: tiltedOrientation(WITHIN) });

    const collections = plan([a, b]);

    expect(collections).toHaveLength(1);
    expect(uidsOf(collections[0])).toEqual(['uid-a', 'uid-b']);
  });

  it('splits orientations whose rows disagree beyond the tolerance', () => {
    const a = makeFacts('uid-a', { orientation: IDENTITY_ORIENTATION });
    const b = makeFacts('uid-b', { orientation: tiltedOrientation(BEYOND) });

    const collections = plan([a, b]);

    expect(collections).toHaveLength(2);
    expect(collectionWith(collections, 'uid-b').orientation).toEqual(
      tiltedOrientation(BEYOND)
    );
  });

  it('buckets a chain of near orientations the same way under permutation', () => {
    const a = makeFacts('uid-a', { orientation: IDENTITY_ORIENTATION });
    const b = makeFacts('uid-b', { orientation: tiltedOrientation(CHAIN) });
    const c = makeFacts('uid-c', { orientation: tiltedOrientation(2 * CHAIN) });

    const forward = plan([a, b, c]);
    const backward = plan([c, b, a]);
    const shuffled = plan([b, c, a]);

    expect(forward).toHaveLength(2);
    expect(uidsOf(collectionWith(forward, 'uid-a'))).toEqual([
      'uid-a',
      'uid-b',
    ]);
    expect(uidsOf(collectionWith(forward, 'uid-c'))).toEqual(['uid-c']);
    expect(backward).toEqual(forward);
    expect(shuffled).toEqual(forward);
  });

  it('buckets a chain of anonymous near orientations the same under permutation', () => {
    const [x, y, z] = [0, CHAIN, 2 * CHAIN].map((theta, position) =>
      makeFacts(null, {
        orientation: tiltedOrientation(theta),
        projectedPosition: position,
      })
    );
    const forward = plan([x, y, z]);

    expect(forward.map((c) => c.members.length)).toEqual([1, 2]);
    expect(plan([z, y, x])).toEqual(forward);
    expect(plan([y, x, z])).toEqual(forward);
  });

  it('buckets an unreadable orientation on its own', () => {
    const a = makeFacts('uid-a');
    const b = makeFacts('uid-b', { orientation: null });

    const collections = plan([a, b]);

    expect(collections).toHaveLength(2);
    expect(uidsOf(collectionWith(collections, 'uid-b'))).toEqual(['uid-b']);
    expect(collectionWith(collections, 'uid-b').orientation).toBeNull();
  });

  it('never merges instances that have no SOP Instance UID', () => {
    const a = makeFacts(null, { projectedPosition: 0, instanceNumber: 1 });
    const b = makeFacts(null, { projectedPosition: 1, instanceNumber: 2 });

    const collections = plan([a, b]);

    expect(collections).toHaveLength(1);
    expect(collections[0].members).toHaveLength(2);
  });

  it('orders members by projected position ascending', () => {
    const high = makeFacts('uid-a', { projectedPosition: 10 });
    const low = makeFacts('uid-b', { projectedPosition: -5 });
    const mid = makeFacts('uid-c', { projectedPosition: 0 });

    const collections = plan([high, low, mid]);

    expect(uidsOf(collections[0])).toEqual(['uid-b', 'uid-c', 'uid-a']);
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

    const collections = plan([later, far, earlier, near]);

    expect(uidsOf(collections[0])).toEqual([
      'uid-d',
      'uid-b',
      'uid-a',
      'uid-c',
    ]);
    expect(collections[0].warnings).toEqual([REPEATED_POSITIONS_WARNING]);
  });

  it('breaks a repeated position on SOP Instance UID when instance numbers tie', () => {
    const second = makeFacts('uid-b', { projectedPosition: 3 });
    const first = makeFacts('uid-a', { projectedPosition: 3 });

    const collections = plan([second, first]);

    expect(uidsOf(collections[0])).toEqual(['uid-a', 'uid-b']);
  });

  it('orders an unnumbered member after a numbered one at the same position', () => {
    const numbered = makeFacts('uid-b', { projectedPosition: 3 });
    const unnumbered = makeFacts('uid-a', {
      projectedPosition: 3,
      instanceNumber: null,
    });
    const low = makeFacts('uid-c', { projectedPosition: 0 });

    const collections = plan([unnumbered, numbered, low]);

    expect(uidsOf(collections[0])).toEqual(['uid-c', 'uid-b', 'uid-a']);
  });

  it('breaks a shared position between anonymous members on instance number', () => {
    const [a, b] = [1, 2].map((instanceNumber) =>
      makeFacts(null, { projectedPosition: 0, instanceNumber })
    );
    const forward = plan([a, b]);

    expect(forward[0].members.map((m) => m.instanceNumber)).toEqual([1, 2]);
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

    const collections = plan([blind, seen, alsoBlind]);

    expect(collections).toHaveLength(2);
    expect(uidsOf(collectionWith(collections, 'uid-b'))).toEqual(['uid-b']);
    expect(collectionWith(collections, 'uid-b').label).toBeNull();

    const unknown = collectionWith(collections, 'uid-a');
    expect(uidsOf(unknown)).toEqual(['uid-c', 'uid-a']);
    expect(unknown.label).toBe('position unknown');
    expect(unknown.warnings).toEqual([UNREADABLE_POSITION_WARNING]);
  });

  it('says nothing about a series that is one positionless instance', () => {
    const alone = makeFacts('uid-a', {
      projectedPosition: null,
      instanceNumber: 1,
    });

    const collections = plan([alone]);

    expect(collections).toHaveLength(1);
    expect(collections[0].label).toBeNull();
    expect(collections[0].warnings).toEqual([]);
  });

  // Two radiograph views of one series: no volume holds either out.
  it('names only what differs between positionless images with no positioned sibling', () => {
    const collections = plan([
      makeFacts('uid-a', { projectedPosition: null, rows: '4' }),
      makeFacts('uid-b', { projectedPosition: null, rows: '8' }),
    ]);

    expect(collections.map((collection) => collection.label)).toEqual([
      'rows 4',
      'rows 8',
    ]);
    expect(collections.flatMap((collection) => collection.warnings)).toEqual(
      []
    );
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

    const collections = plan([alone, seen]);

    expect(collectionWith(collections, 'uid-a').label).toBe('position unknown');
    expect(collectionWith(collections, 'uid-a').warnings).toEqual([
      UNREADABLE_POSITION_WARNING,
    ]);
  });

  it('orders a positionless stack on instance number, then SOP Instance UID, and warns', () => {
    const second = makeFacts('uid-b', {
      projectedPosition: null,
      instanceNumber: 4,
    });
    const first = makeFacts('uid-a', {
      projectedPosition: null,
      instanceNumber: 4,
    });
    const earlier = makeFacts('uid-c', {
      projectedPosition: null,
      instanceNumber: 1,
    });

    const collections = plan([second, first, earlier]);

    expect(uidsOf(collections[0])).toEqual(['uid-c', 'uid-a', 'uid-b']);
    expect(collections[0].label).toBeNull();
    expect(collections[0].warnings).toEqual([UNREADABLE_POSITION_WARNING]);
  });

  it('keeps input order when neither position nor instance number reads', () => {
    const second = makeFacts('uid-b', {
      projectedPosition: null,
      instanceNumber: null,
    });
    const first = makeFacts('uid-a', {
      projectedPosition: null,
      instanceNumber: null,
    });

    const collections = plan([second, first]);

    expect(uidsOf(collections[0])).toEqual(['uid-b', 'uid-a']);
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

    expect(base).toHaveLength(3);
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

  it('holds every instance exactly once, under a key no other collection shares', () => {
    const instances = [
      ...permutable(),
      makeFacts('uid-7', { projectedPosition: null }),
      makeFacts('uid-8', { rows: '8' }),
    ];

    const collections = plan(instances);
    const members = collections.flatMap((c) => c.members);

    expect(collections).toHaveLength(5);
    expect(members).toHaveLength(instances.length);
    expect(new Set(members)).toEqual(new Set(instances));
    expect(new Set(collections.map((c) => JSON.stringify(c.key))).size).toBe(
      collections.length
    );
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

    const collections = plan([straight, tilted]);

    expect(collections).toHaveLength(1);
    expect(collections[0].warnings).toEqual([REPEATED_POSITIONS_WARNING]);
  });

  it('partitions each orientation bucket on its own', () => {
    const stack = [...pass('1', [0, 2]), ...pass('2', [1, 3])];
    const scout = makeFacts('scout', {
      orientation: tiltedOrientation(BEYOND),
      acquisitionNumber: '1',
    });

    const collections = plan([...stack, scout]);

    expect(collections).toHaveLength(3);
    expect(collectionWith(collections, 'scout').label).toBeNull();
    expect(collectionWith(collections, 'acq1-0').label).toBe('acquisition 1');
    expect(uidsOf(collectionWith(collections, 'acq1-0'))).toEqual([
      'acq1-0',
      'acq1-1',
    ]);
    expect(collectionWith(collections, 'acq2-0').label).toBe('acquisition 2');
  });

  it('warns that an unevenly spaced collection is not one regular volume', () => {
    // Two 4mm runs with a gap between them, as the bilateral sagittal slabs
    // of idcSeriesFixtures.ts are. One collection, but no single lattice.
    const collections = plan(pass('1', [0, 4, 8, 50, 54, 58]));

    expect(collections).toHaveLength(1);
    expect(collections[0].warnings).toEqual([IRREGULAR_VOLUME_WARNING]);
  });

  it('leaves an evenly spaced collection unwarned and unlabelled', () => {
    const collections = plan(pass('1', [0, 4, 8, 12]));

    expect(collections[0].label).toBeNull();
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

    const collections = plan(stack);

    expect(collections).toHaveLength(1);
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
      const collections = plan(wideStack(strayUid, 0.0002));

      expect(collections).toHaveLength(1);
      expect(collections[0].orientation).toEqual(IDENTITY_ORIENTATION);
      expect(collections[0].warnings).toEqual([]);
    }
  );

  it('warns when a slice leans off the volume axes by more than a tenth of a millimetre', () => {
    const collections = plan(wideStack('wide-stray', 0.001));

    expect(collections).toHaveLength(1);
    expect(collections[0].orientation).toEqual(IDENTITY_ORIENTATION);
    expect(collections[0].warnings).toEqual([NONPARALLEL_SLICES_WARNING]);
  });

  it('does not assume a physical scale when judging an unknown pixel spacing', () => {
    const members = wideStack('wide-stray', 0.001).map((member) => ({
      ...member,
      pixelSpacing: null,
    }));

    expect(plan(members)[0].warnings).not.toContain(NONPARALLEL_SLICES_WARNING);
  });
});

describe('independent multi-frame instances', () => {
  it('keeps anonymous clip keys stable when an earlier clip is removed', () => {
    const clips = [0, 1, 2].map(() => makeFacts(null, { numberOfFrames: '3' }));
    const before = plan(clips.slice(0, 2));
    const after = plan(clips.slice(1));
    const keyOf = (collections: DicomCollection[], member: InstanceFacts) =>
      collections.find((collection) => collection.members.includes(member))!
        .key;

    expect(keyOf(after, clips[1])).toEqual(keyOf(before, clips[1]));
    expect(keyOf(after, clips[2])).not.toEqual(keyOf(before, clips[0]));
  });

  it.each([null, 0])(
    'keeps equal-shaped clips separate and unlabelled at position %s',
    (position) => {
      const instances = ['clip-a', 'clip-b'].map((uid) =>
        makeFacts(uid, {
          numberOfFrames: '3',
          position: position === null ? null : [0, 0, position],
          projectedPosition: position,
        })
      );
      const collections = plan(instances);
      expect(collections.map((c) => uidsOf(c))).toEqual([
        ['clip-a'],
        ['clip-b'],
      ]);
      expect(collections.map((c) => c.label)).toEqual([null, null]);
      expect(new Set(collections.map((c) => JSON.stringify(c.key))).size).toBe(
        2
      );
      expect(plan([...instances].reverse())).toEqual(plan(instances));
    }
  );
});

describe('acquisition descriptors', () => {
  const descriptors: Array<[keyof InstanceFacts, string]> = [
    ['seriesNumber', '2'],
    ['sequenceName', '*ep_b1000t'],
    ['sliceThickness', '2'],
    ['seriesDate', '20240202'],
  ];

  const run = (uid: string, zs: number[], facts: Partial<InstanceFacts>) =>
    zs.map((z) => makeFacts(`${uid}-${z}`, { projectedPosition: z, ...facts }));

  it.each(descriptors)(
    'separates and labels overlapping stacks by %s',
    (fact, value) => {
      const collections = plan([
        ...run('first', [0, 2, 4], { [fact]: '1' }),
        ...run('second', [1, 3, 5], { [fact]: value }),
      ]);

      expect(collections).toHaveLength(2);
      expect(collections.every((collection) => collection.label !== null)).toBe(
        true
      );
      expect(
        new Set(collections.map((collection) => collection.label)).size
      ).toBe(2);
    }
  );

  it('keeps independent single-plane images apart when a descriptor differs', () => {
    const collections = plan([
      makeFacts('first', { seriesDate: '20240101' }),
      makeFacts('second', { seriesDate: '20240202' }),
    ]);

    expect(collections.map((collection) => collection.label)).toEqual([
      'date 20240101',
      'date 20240202',
    ]);
    expect(
      collections.map((collection) => collection.reconstruction.kind)
    ).toEqual(['regular', 'regular']);
  });

  it('keeps an unknown sequence separate from a named sequence on one plane', () => {
    const collections = plan([
      makeFacts('unknown', { sequenceName: null }),
      makeFacts('known', { sequenceName: '*ep_b0' }),
    ]);

    expect(collections.map((collection) => collection.label).sort()).toEqual([
      'sequence *ep_b0',
      'sequence unknown',
    ]);
  });

  it('keeps a stack whole across one differing descriptor', () => {
    const slices = run('slice', [0, 1, 2, 3, 4], {});
    slices[2] = { ...slices[2], sliceThickness: '2' };
    const collections = plan(slices);

    expect(collections).toHaveLength(1);
    expect(collections[0].reconstruction).toEqual({
      kind: 'regular',
      sliceSpacing: 1,
    });
  });

  it('keeps adjoining stacks together across a descriptor', () => {
    const collections = plan([
      ...run('first', [0, 1, 2], { seriesNumber: '1' }),
      ...run('second', [3, 4, 5], { seriesNumber: '2' }),
    ]);

    expect(collections).toHaveLength(1);
    expect(collections[0].reconstruction.kind).toBe('regular');
  });

  it('labels DWI stacks by b-value when sequence names also differ', () => {
    const collections = plan([
      ...run('b0', [0, 1, 2], { sequenceName: '*ep_b0', diffusionBValue: '0' }),
      ...run('b1000', [0, 1, 2], {
        sequenceName: '*ep_b1000t',
        diffusionBValue: '1000',
      }),
    ]);

    expect(collections.map((collection) => collection.label)).toEqual([
      'b-value 0',
      'b-value 1000',
    ]);
  });

  it('keeps anonymous single-plane ordering stable across descriptor differences', () => {
    const members = ['second', 'first'].map((sequenceName) =>
      makeFacts(null, { sequenceName })
    );

    expect(plan(members)).toEqual(plan([...members].reverse()));
  });

  it('keeps incompatible acquisition descriptors apart when geometry is unreadable', () => {
    const collections = plan(
      ['first', 'second'].map((sequenceName) =>
        makeFacts(sequenceName, {
          sequenceName,
          orientation: null,
          position: null,
        })
      )
    );

    expect(collections.map((collection) => collection.label).sort()).toEqual([
      'sequence first',
      'sequence second',
    ]);
    expect(collections.flatMap((collection) => collection.warnings)).toEqual(
      []
    );
  });
});
