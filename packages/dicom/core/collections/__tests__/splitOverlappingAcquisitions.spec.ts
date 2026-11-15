import { describe, it, expect } from 'vitest';
import { Tags } from '../../metadata/dicomTags';
import type { InstanceFacts } from '../planDicomCollections';
import { splitOverlappingAcquisitions } from '../splitOverlappingAcquisitions';
import { makeFacts } from './instanceFactsFixture';
import {
  bilateralSagittalSlabs,
  dceEightPhase,
  dixonDualEcho,
  dixonUnevenEchoes,
  doubledAcquisition,
  dwiMultiBValue,
  partialTemporalTags,
  type SliceGroup,
} from './idcSeriesFixtures';
import { sliceFacts } from './sliceFixture';

type SemanticPart = ReturnType<typeof splitOverlappingAcquisitions>[number];

const zOf = (facts: InstanceFacts) => facts.projectedPosition as number;
const byPosition = (a: InstanceFacts, b: InstanceFacts) => zOf(a) - zOf(b);

const split = (members: InstanceFacts[]) =>
  splitOverlappingAcquisitions(members, (member) => member.projectedPosition);

// An axial slice at z carrying the given tags.
const slice = (z: number, tags: Record<string, string> = {}) =>
  sliceFacts({ z, tags });

// A stack of `count` slices starting at `start`, tagged with an acquisition.
const stack = (acquisition: string, start: number, count: number, step = 2.5) =>
  Array.from({ length: count }, (_, i) =>
    slice(start + i * step, { [Tags.AcquisitionNumber]: acquisition })
  );

// Slices mirroring a real IDC series recorded in idcSeriesFixtures.ts.
const fixtureSlices = (groups: SliceGroup[]) =>
  groups
    .flatMap((group) => group.zs.map((z) => slice(z, group.tags)))
    .sort(byPosition);

const labels = (parts: SemanticPart[]) =>
  parts.map((part) => part.label).sort();

const partLabelled = (parts: SemanticPart[], label: string | null) => {
  const found = parts.find((part) => part.label === label);
  if (!found) throw new Error(`no part labelled ${label}`);
  return found;
};

describe('splitOverlappingAcquisitions', () => {
  it('passes a single acquisition through as one unlabelled part', () => {
    const members = stack('1', 0, 5);

    const parts = split(members);

    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      members,
      label: null,
      repeatedPositions: false,
      unreadablePositions: false,
    });
  });

  it('separates overlapping acquisitions merged into one series', () => {
    // The reference bug, IDC series
    // 1.3.6.1.4.1.14519.5.2.1.3098.5025.295130953269492004748715270821
    // ("ST+ N15/12/17 A30/20/40"): three overlapping 2.5mm passes that merged
    // into one 447-slice volume at a fabricated 1.478mm spacing.
    const acq1 = stack('1', -20, 5);
    const acq2 = stack('2', -19.25, 6);
    const acq3 = stack('3', -18.5, 4);

    const parts = split([...acq1, ...acq2, ...acq3].sort(byPosition));

    expect(labels(parts)).toEqual([
      'acquisition 1',
      'acquisition 2',
      'acquisition 3',
    ]);
    expect(partLabelled(parts, 'acquisition 1').members).toEqual(acq1);
    expect(partLabelled(parts, 'acquisition 2').members).toEqual(acq2);
    expect(partLabelled(parts, 'acquisition 3').members).toEqual(acq3);
    expect(parts.every((part) => !part.repeatedPositions)).toBe(true);
  });

  it('keeps acquisitions that follow one another together', () => {
    // IDC series
    // 1.3.6.1.4.1.14519.5.2.1.7009.2403.262533307142705262678914598920
    // ("Recon 2: CHEST"): one continuous 5mm stack whose slices carry three
    // acquisition numbers, with a 30mm hole where slices are missing. Uneven
    // spacing is not a reason to tear the scans apart.
    const merged = [
      ...stack('3', -320.25, 4, 5),
      ...stack('2', -300.25, 6, 5),
      ...stack('1', -245.25, 56, 5),
    ].sort(byPosition);

    const parts = split(merged);

    expect(parts).toHaveLength(1);
    expect(parts[0].members).toEqual(merged);
    expect(parts[0].label).toBeNull();
    expect(parts[0].repeatedPositions).toBe(false);
  });

  it('leaves a long run of sequential acquisitions merged', () => {
    // IDC series
    // 1.3.6.1.4.1.14519.5.2.1.3320.3273.243812674588352758771557518364:
    // acquisitions numbered 20 through 36 across one evenly spaced stack.
    const groups = Array.from({ length: 17 }, (_, i) =>
      stack(String(20 + i), i * 25, 10)
    );

    const parts = split(groups.flat().sort(byPosition));

    expect(parts).toHaveLength(1);
  });

  it('leaves repeat scans of one plane whole and flags the repetition', () => {
    // IDC series
    // 1.3.6.1.4.1.14519.5.2.1.7009.2403.668914995861790731496154478744
    // ("Smart Prep Series"), bolus tracking: seven scans of the same slice,
    // one acquisition each. That is a time series of one plane, and fanning it
    // out would make seven one-slice datasets.
    const members = Array.from({ length: 7 }, (_, i) =>
      slice(-82.89, { [Tags.AcquisitionNumber]: String(i + 1) })
    );

    const parts = split(members);

    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      members,
      label: null,
      repeatedPositions: true,
      unreadablePositions: false,
    });
  });

  it('does not fan out a counter stamped per slice over one repeated position', () => {
    // Some scanners set AcquisitionNumber from InstanceNumber. One duplicate
    // slice must not turn such a stack into one dataset per slice.
    const members = [0, 2.5, 5, 5, 7.5, 10].map((z, i) =>
      slice(z, { [Tags.AcquisitionNumber]: String(i + 1) })
    );

    const parts = split(members);

    expect(parts).toHaveLength(1);
    expect(parts[0].label).toBeNull();
    expect(parts[0].repeatedPositions).toBe(true);
  });

  it('leaves a single overlapping slice of another pass merged', () => {
    const members = [...stack('1', 0, 3), ...stack('2', 2.5, 1)].sort(
      byPosition
    );

    const parts = split(members);

    expect(parts).toHaveLength(1);
    expect(parts[0].repeatedPositions).toBe(true);
  });

  it.each([
    ['acquisition', Tags.AcquisitionNumber],
    ['phase', Tags.TemporalPositionIdentifier],
  ])(
    'keeps singleton %s values with the remainder of overlapping scans',
    (rule, tag) => {
      const scans = ['1', '2'].flatMap((value) =>
        [0, 2, 4, 6, 8].map((z) => slice(z, { [tag]: value }))
      );
      const remainder = [
        slice(1, { [tag]: '3' }),
        slice(3),
        slice(5, { [tag]: '4' }),
      ];

      const parts = split([...scans, ...remainder].sort(byPosition));

      expect(labels(parts)).toEqual([
        `${rule} 1`,
        `${rule} 2`,
        `${rule} mixed`,
      ]);
      expect(partLabelled(parts, `${rule} mixed`).members).toEqual(remainder);
    }
  );

  it('still separates contrasts within singleton counter values', () => {
    const scans = [...stack('1', 0, 3), ...stack('2', 0, 3)];
    const contrasts = ['1', '2'].map((echo, index) =>
      slice(2.5, {
        [Tags.AcquisitionNumber]: String(index + 3),
        [Tags.EchoNumbers]: echo,
      })
    );

    const parts = split([...scans, ...contrasts]);

    expect(labels(parts)).toEqual([
      'acquisition 1',
      'acquisition 2',
      'acquisition 3, echo 1',
      'acquisition 4, echo 2',
    ]);
    contrasts.forEach((member, index) =>
      expect(
        partLabelled(parts, `acquisition ${index + 3}, echo ${index + 1}`)
          .members
      ).toEqual([member])
    );
  });

  it('leaves a repeated plane inside a split whole', () => {
    // A full stack plus a bolus-tracking pass of one plane, each frame with
    // its own phase: the pass is a time series, not twenty datasets.
    const volume = stack('1', 0, 10);
    const monitoring = Array.from({ length: 20 }, (_, i) =>
      slice(5, {
        [Tags.AcquisitionNumber]: '2',
        [Tags.TemporalPositionIdentifier]: String(i + 1),
      })
    );

    const parts = split([...volume, ...monitoring].sort(byPosition));

    expect(labels(parts)).toEqual(['acquisition 1', 'acquisition 2']);
    expect(partLabelled(parts, 'acquisition 2').members).toHaveLength(20);
    expect(partLabelled(parts, 'acquisition 2').repeatedPositions).toBe(true);
  });

  it('separates scans that share a boundary slice', () => {
    const merged = [...stack('1', 0, 4), ...stack('2', 7.5, 4)].sort(
      byPosition
    );

    expect(labels(split(merged))).toEqual(['acquisition 1', 'acquisition 2']);
  });

  it('does not separate scans that abut without overlapping', () => {
    const merged = [...stack('1', 0, 4), ...stack('2', 10, 4)].sort(byPosition);

    expect(split(merged)).toHaveLength(1);
  });

  it('holds members whose position cannot be read in a part of their own', () => {
    const blind = makeFacts('uid-a', {
      projectedPosition: null,
      acquisitionNumber: '1',
    });
    const first = stack('2', 0, 3);
    const second = stack('3', 1, 3);

    const parts = split([blind, ...first, ...second]);

    // The two overlapping acquisitions stay separated, and the member nothing
    // spatial can be said about is held apart rather than merged into them.
    expect(parts).toHaveLength(3);
    const unknown = parts.find((part) => part.unreadablePositions)!;
    expect(unknown.members).toEqual([blind]);
    expect(partLabelled(parts, 'acquisition 2').members).toEqual(first);
    expect(partLabelled(parts, 'acquisition 3').members).toEqual(second);
    expect(parts.filter((part) => part.unreadablePositions)).toEqual([unknown]);
  });

  it('keeps members whose positions are all unreadable in one part', () => {
    const blind = [
      makeFacts('uid-a', { projectedPosition: null }),
      makeFacts('uid-b', { projectedPosition: null }),
    ];

    const parts = split(blind);

    expect(parts).toHaveLength(1);
    expect(parts[0].members).toEqual(blind);
    expect(parts[0].unreadablePositions).toBe(true);
  });

  it('is invariant to member permutation in membership', () => {
    const acq1 = stack('1', -20, 5);
    const acq2 = stack('2', -19.25, 6);
    const forward = split([...acq1, ...acq2]);
    const backward = split([...acq2, ...acq1].reverse());

    const membership = (parts: SemanticPart[]) =>
      parts
        .map((part) => ({
          label: part.label,
          uids: part.members.map((m) => m.sopInstanceUid).sort(),
        }))
        .sort((a, b) => (a.label! < b.label! ? -1 : 1));

    expect(membership(backward)).toEqual(membership(forward));
  });
});

describe('splitOverlappingAcquisitions temporal and echo axes', () => {
  it('separates DCE timepoints that re-scan one range', () => {
    const parts = split(fixtureSlices(dceEightPhase));

    expect(labels(parts)).toEqual(
      ['0', '1', '2', '3', '4', '5', '6', '7'].map((p) => `phase ${p}`)
    );
    expect(partLabelled(parts, 'phase 3').members).toHaveLength(80);
    expect(parts.every((part) => !part.repeatedPositions)).toBe(true);
  });

  it('separates Dixon echoes that nothing else distinguishes', () => {
    const parts = split(fixtureSlices(dixonDualEcho));

    expect(labels(parts)).toEqual(['echo 1', 'echo 2']);
  });

  it('separates echoes with unequal slice counts', () => {
    const parts = split(fixtureSlices(dixonUnevenEchoes));

    expect(partLabelled(parts, 'echo 1').members).toHaveLength(13);
    expect(partLabelled(parts, 'echo 2').members).toHaveLength(12);
  });

  it('separates repeated diffusion positions by b-value', () => {
    const parts = split(fixtureSlices(dwiMultiBValue));

    expect(labels(parts)).toEqual([
      'b-value 0',
      'b-value 100',
      'b-value 600',
      'b-value 800',
    ]);
    parts.forEach((part) => {
      expect(part.members).toHaveLength(30);
      expect(part.repeatedPositions).toBe(false);
    });
  });

  it('isolates a slice missing the discriminator instead of blocking the split', () => {
    const b0 = [0, 2, 4].map((z) => slice(z, { [Tags.DiffusionBValue]: '0' }));
    const b800 = [0, 2, 4].map((z) =>
      slice(z, { [Tags.DiffusionBValue]: '800' })
    );
    const untagged = slice(2);

    const parts = split([...b0, untagged, ...b800].sort(byPosition));

    expect(labels(parts)).toEqual([
      'b-value 0',
      'b-value 800',
      'b-value unknown',
    ]);
    expect(partLabelled(parts, 'b-value unknown').members).toEqual([untagged]);
  });

  it('still separates contrasts of a single plane', () => {
    // A one-slice in/out-phase pair differs in echo, not in time, so each
    // echo is its own dataset even at one position.
    const members = ['1', '2'].map((echo) =>
      slice(0, { [Tags.AcquisitionNumber]: '1', [Tags.EchoNumbers]: echo })
    );

    const parts = split(members);

    expect(labels(parts)).toEqual(['echo 1', 'echo 2']);
    expect(parts.every((part) => !part.repeatedPositions)).toBe(true);
  });

  it('does not split bilateral slabs whose stacks do not overlap', () => {
    // StackID (0020|9056) differs per slab, but the slabs form one sound
    // volume with a gap; this series is why StackID is not an axis.
    const parts = split(fixtureSlices(bilateralSagittalSlabs));

    expect(parts).toHaveLength(1);
    expect(parts[0].repeatedPositions).toBe(false);
  });

  it('splits on acquisition when the temporal tag is partially present', () => {
    const parts = split(fixtureSlices(partialTemporalTags));

    expect(labels(parts)).toEqual(
      ['1', '2', '3', '4', '5', '6', '7'].map((a) => `acquisition ${a}`)
    );
    expect(partLabelled(parts, 'acquisition 1').members).toHaveLength(72);
    expect(parts.every((part) => !part.repeatedPositions)).toBe(true);
  });

  it('splits a doubled acquisition and still flags the repetition', () => {
    const parts = split(fixtureSlices(doubledAcquisition));

    expect(labels(parts)).toEqual(['acquisition 1', 'acquisition 2']);
    expect(partLabelled(parts, 'acquisition 1').members).toHaveLength(74);
    expect(partLabelled(parts, 'acquisition 1').repeatedPositions).toBe(false);
    expect(partLabelled(parts, 'acquisition 2').members).toHaveLength(148);
    expect(partLabelled(parts, 'acquisition 2').repeatedPositions).toBe(true);
  });

  it('recurses into each timepoint of a 4D multi-echo series', () => {
    // Synthetic: no IDC case observed with two active levels.
    const merged = ['1', '2']
      .flatMap((phase) =>
        ['1', '2'].flatMap((echo) =>
          Array.from({ length: 10 }, (_, i) =>
            slice(i * 2, {
              [Tags.AcquisitionNumber]: '1',
              [Tags.TemporalPositionIdentifier]: phase,
              [Tags.EchoNumbers]: echo,
            })
          )
        )
      )
      .sort(byPosition);

    const parts = split(merged);

    expect(labels(parts)).toEqual([
      'phase 1, echo 1',
      'phase 1, echo 2',
      'phase 2, echo 1',
      'phase 2, echo 2',
    ]);
    parts.forEach((part) => {
      expect(part.members).toHaveLength(10);
    });
  });
});
