import { describe, it, expect } from 'vitest';
import { Tags } from '@/src/core/dicomTags';
import { readInstanceFacts } from '@/src/core/dicom/instanceFacts';
import type { InstanceFacts } from '@/src/core/dicom/planDicomCollections';
import {
  GEOMETRY_RULE,
  SEMANTIC_AXES,
  UNREADABLE_GEOMETRY,
  UNREADABLE_GEOMETRY_LABEL,
  splitOverlappingAcquisitions,
  type SemanticPart,
} from '@/src/core/dicom/splitOverlappingAcquisitions';
import { makeFacts } from '@/src/core/dicom/__tests__/instanceFactsFixture';
import {
  bilateralSagittalSlabs,
  dceEightPhase,
  dceSevenPhasePhilips,
  dixonDualEcho,
  dixonUnevenEchoes,
  doubledAcquisition,
  dwiMultiBValue,
  partialTemporalTags,
  type IdcSeriesFixture,
} from '@/src/core/dicom/__tests__/idcSeriesFixtures';

let nextUid = 0;

// An axial slice at z carrying the given tags, read through the fact reader so
// the fixtures stay in the tag vocabulary the real data uses.
function slice(z: number, tags: Record<string, string> = {}) {
  nextUid += 1;
  return readInstanceFacts([
    [Tags.SOPInstanceUID, `1.2.3.${nextUid}`],
    [Tags.ImageOrientationPatient, '1\\0\\0\\0\\1\\0'],
    [Tags.ImagePositionPatient, `0\\0\\${z}`],
    ...Object.entries(tags),
  ]);
}

// A stack of `count` slices starting at `start`, tagged with an acquisition.
const stack = (acquisition: string, start: number, count: number, step = 2.5) =>
  Array.from({ length: count }, (_, i) =>
    slice(start + i * step, { [Tags.AcquisitionNumber]: acquisition })
  );

const zOf = (facts: InstanceFacts) => facts.projectedPosition as number;
const byPosition = (a: InstanceFacts, b: InstanceFacts) => zOf(a) - zOf(b);

// Slices mirroring a real IDC series recorded in idcSeriesFixtures.ts.
const fixtureSlices = (fixture: IdcSeriesFixture) =>
  fixture
    .groups!.flatMap((group) => group.zs.map((z) => slice(z, group.tags)))
    .sort(byPosition);

const labels = (parts: SemanticPart[]) =>
  parts.map((part) => part.label).sort();

const partLabelled = (parts: SemanticPart[], label: string | null) => {
  const found = parts.find((part) => part.label === label);
  if (!found) throw new Error(`no part labelled ${label}`);
  return found;
};

const partValue = (part: SemanticPart, rule: string) => {
  const entry = part.parts.find(([name]) => name === rule);
  if (!entry) throw new Error(`no part named ${rule}`);
  return entry[1];
};

const unsplitParts = SEMANTIC_AXES.map((axis) => [axis.rule, null]);

describe('splitOverlappingAcquisitions', () => {
  it('passes a single acquisition through as one unlabelled part', () => {
    const members = stack('1', 0, 5);

    const parts = splitOverlappingAcquisitions(members);

    expect(parts).toEqual([
      {
        parts: unsplitParts,
        members,
        label: null,
        repeatedPositions: false,
        unreadablePositions: false,
      },
    ]);
  });

  it('names one key part per axis, in axis order, split or not', () => {
    const parts = splitOverlappingAcquisitions(stack('1', 0, 3));

    expect(parts[0].parts.map(([rule]) => rule)).toEqual([
      'acquisition',
      'phase',
      'echo',
      'b-value',
    ]);
  });

  it('separates overlapping acquisitions merged into one series', () => {
    // The reference bug, IDC series
    // 1.3.6.1.4.1.14519.5.2.1.3098.5025.295130953269492004748715270821
    // ("ST+ N15/12/17 A30/20/40"): three overlapping 2.5mm passes that merged
    // into one 447-slice volume at a fabricated 1.478mm spacing.
    const acq1 = stack('1', -20, 5);
    const acq2 = stack('2', -19.25, 6);
    const acq3 = stack('3', -18.5, 4);

    const parts = splitOverlappingAcquisitions(
      [...acq1, ...acq2, ...acq3].sort(byPosition)
    );

    expect(labels(parts)).toEqual([
      'acquisition 1',
      'acquisition 2',
      'acquisition 3',
    ]);
    expect(partLabelled(parts, 'acquisition 1').members).toEqual(acq1);
    expect(partLabelled(parts, 'acquisition 2').members).toEqual(acq2);
    expect(partLabelled(parts, 'acquisition 3').members).toEqual(acq3);
    expect(partLabelled(parts, 'acquisition 2').parts).toEqual([
      ['acquisition', '2'],
      ['phase', null],
      ['echo', null],
      ['b-value', null],
    ]);
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

    const parts = splitOverlappingAcquisitions(merged);

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

    const parts = splitOverlappingAcquisitions(groups.flat().sort(byPosition));

    expect(parts).toHaveLength(1);
  });

  it('tolerates quantized whole-body PET positions', () => {
    // IDC series
    // 1.3.6.1.4.1.14519.5.2.1.7009.2403.337074050757748643824459343650
    // ("WB_3D_NON-AC"): whole-body PET stepping by 3.27mm with the occasional
    // 3.35mm step from printing precision. One acquisition, nothing to
    // separate.
    const members = [0, 3.27, 6.54, 9.89, 13.16, 16.43].map((z) =>
      slice(z, { [Tags.AcquisitionNumber]: '1' })
    );

    const parts = splitOverlappingAcquisitions(members);

    expect(parts).toHaveLength(1);
    expect(parts[0].repeatedPositions).toBe(false);
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

    const parts = splitOverlappingAcquisitions(members);

    expect(parts).toEqual([
      {
        parts: unsplitParts,
        members,
        label: null,
        repeatedPositions: true,
        unreadablePositions: false,
      },
    ]);
  });

  it('does not fan out a counter stamped per slice over one repeated position', () => {
    // Some scanners set AcquisitionNumber from InstanceNumber. One duplicate
    // slice must not turn such a stack into one dataset per slice.
    const members = [0, 2.5, 5, 5, 7.5, 10].map((z, i) =>
      slice(z, { [Tags.AcquisitionNumber]: String(i + 1) })
    );

    const parts = splitOverlappingAcquisitions(members);

    expect(parts).toHaveLength(1);
    expect(parts[0].label).toBeNull();
    expect(parts[0].repeatedPositions).toBe(true);
  });

  it('leaves a single overlapping slice of another pass merged', () => {
    const members = [...stack('1', 0, 3), ...stack('2', 2.5, 1)].sort(
      byPosition
    );

    const parts = splitOverlappingAcquisitions(members);

    expect(parts).toHaveLength(1);
    expect(parts[0].repeatedPositions).toBe(true);
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

    const parts = splitOverlappingAcquisitions(
      [...volume, ...monitoring].sort(byPosition)
    );

    expect(labels(parts)).toEqual(['acquisition 1', 'acquisition 2']);
    expect(partLabelled(parts, 'acquisition 2').members).toHaveLength(20);
    expect(partLabelled(parts, 'acquisition 2').repeatedPositions).toBe(true);
  });

  it('separates scans that share a boundary slice', () => {
    const merged = [...stack('1', 0, 4), ...stack('2', 7.5, 4)].sort(
      byPosition
    );

    expect(labels(splitOverlappingAcquisitions(merged))).toEqual([
      'acquisition 1',
      'acquisition 2',
    ]);
  });

  it('does not separate scans that abut without overlapping', () => {
    const merged = [...stack('1', 0, 4), ...stack('2', 10, 4)].sort(byPosition);

    expect(splitOverlappingAcquisitions(merged)).toHaveLength(1);
  });

  it('reports repeated positions no axis separates', () => {
    const members = [0, 2.5, 2.5, 5].map((z) =>
      slice(z, { [Tags.AcquisitionNumber]: '1' })
    );

    const parts = splitOverlappingAcquisitions(members);

    expect(parts).toHaveLength(1);
    expect(parts[0].repeatedPositions).toBe(true);
  });

  it('ignores slices with no acquisition number', () => {
    const members = [0, 2.5, 5, 6.25, 8.75].map((z) => slice(z));

    const parts = splitOverlappingAcquisitions(members);

    expect(parts).toHaveLength(1);
    expect(parts[0].repeatedPositions).toBe(false);
  });

  it('holds members whose position cannot be read in a part of their own', () => {
    const blind = makeFacts('uid-a', {
      projectedPosition: null,
      acquisitionNumber: '1',
    });
    const first = stack('2', 0, 3);
    const second = stack('3', 1, 3);

    const parts = splitOverlappingAcquisitions([blind, ...first, ...second]);

    // The two overlapping acquisitions stay separated, and the member nothing
    // spatial can be said about is diagnosed rather than merged into them.
    expect(labels(parts)).toEqual([
      'acquisition 2',
      'acquisition 3',
      UNREADABLE_GEOMETRY_LABEL,
    ]);
    const unknown = partLabelled(parts, UNREADABLE_GEOMETRY_LABEL);
    expect(unknown.members).toEqual([blind]);
    expect(partLabelled(parts, 'acquisition 2').members).toEqual(first);
    expect(partLabelled(parts, 'acquisition 3').members).toEqual(second);
    expect(unknown.unreadablePositions).toBe(true);
    expect(partValue(unknown, GEOMETRY_RULE)).toBe(UNREADABLE_GEOMETRY);
    parts
      .filter((part) => part !== unknown)
      .forEach((part) => {
        expect(part.unreadablePositions).toBe(false);
        expect(part.parts.some(([rule]) => rule === GEOMETRY_RULE)).toBe(false);
      });
  });

  it('keeps members whose positions are all unreadable in one diagnosed part', () => {
    const blind = [
      makeFacts('uid-a', { projectedPosition: null }),
      makeFacts('uid-b', { projectedPosition: null }),
    ];

    const parts = splitOverlappingAcquisitions(blind);

    expect(parts).toHaveLength(1);
    expect(parts[0].members).toEqual(blind);
    expect(parts[0].unreadablePositions).toBe(true);
  });

  it('keeps each part in the member order it was given', () => {
    const acq1 = stack('1', -20, 5);
    const acq2 = stack('2', -19.25, 6);
    const merged = [...acq1, ...acq2].sort(byPosition);

    const parts = splitOverlappingAcquisitions(merged);

    parts.forEach((part) => {
      expect(part.members).toEqual([...part.members].sort(byPosition));
    });
  });

  it('is invariant to member permutation in membership', () => {
    const acq1 = stack('1', -20, 5);
    const acq2 = stack('2', -19.25, 6);
    const forward = splitOverlappingAcquisitions([...acq1, ...acq2]);
    const backward = splitOverlappingAcquisitions([...acq2, ...acq1].reverse());

    const membership = (parts: SemanticPart[]) =>
      parts
        .map((part) => ({
          label: part.label,
          uids: part.members.map((m) => m.sopInstanceUid).sort(),
        }))
        .sort((a, b) => (a.label! < b.label! ? -1 : 1));

    expect(membership(backward)).toEqual(membership(forward));
  });

  it('keeps the value spelling the fact reader normalized', () => {
    const merged = [...stack('01', 0, 5), ...stack('+2', 0.75, 5)].sort(
      byPosition
    );

    const parts = splitOverlappingAcquisitions(merged);

    expect(labels(parts)).toEqual(['acquisition 1', 'acquisition 2']);
  });
});

describe('splitOverlappingAcquisitions temporal and echo axes', () => {
  it('separates DCE timepoints that re-scan one range', () => {
    const parts = splitOverlappingAcquisitions(fixtureSlices(dceEightPhase));

    expect(labels(parts)).toEqual(
      ['0', '1', '2', '3', '4', '5', '6', '7'].map((p) => `phase ${p}`)
    );
    expect(partLabelled(parts, 'phase 3').members).toHaveLength(80);
    expect(partValue(partLabelled(parts, 'phase 3'), 'phase')).toBe('3');
    expect(parts.every((part) => !part.repeatedPositions)).toBe(true);
  });

  it('separates timepoints across vendors and 1-based numbering', () => {
    const parts = splitOverlappingAcquisitions(
      fixtureSlices(dceSevenPhasePhilips)
    );

    expect(parts).toHaveLength(7);
    parts.forEach((part) => {
      expect(part.members).toHaveLength(158);
      expect(part.repeatedPositions).toBe(false);
    });
  });

  it('separates Dixon echoes that nothing else distinguishes', () => {
    const parts = splitOverlappingAcquisitions(fixtureSlices(dixonDualEcho));

    expect(labels(parts)).toEqual(['echo 1', 'echo 2']);
    expect(partLabelled(parts, 'echo 1').parts).toEqual([
      ['acquisition', null],
      ['phase', null],
      ['echo', '1'],
      ['b-value', null],
    ]);
  });

  it('separates echoes with unequal slice counts', () => {
    const parts = splitOverlappingAcquisitions(
      fixtureSlices(dixonUnevenEchoes)
    );

    expect(partLabelled(parts, 'echo 1').members).toHaveLength(13);
    expect(partLabelled(parts, 'echo 2').members).toHaveLength(12);
  });

  it('separates repeated diffusion positions by b-value', () => {
    const parts = splitOverlappingAcquisitions(fixtureSlices(dwiMultiBValue));

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

    const parts = splitOverlappingAcquisitions(
      [...b0, untagged, ...b800].sort(byPosition)
    );

    expect(labels(parts)).toEqual([
      'b-value 0',
      'b-value 800',
      'b-value unknown',
    ]);
    expect(partLabelled(parts, 'b-value unknown').members).toEqual([untagged]);
    expect(
      partValue(partLabelled(parts, 'b-value unknown'), 'b-value')
    ).toBeNull();
  });

  it('still separates contrasts of a single plane', () => {
    // A one-slice in/out-phase pair differs in echo, not in time, so each
    // echo is its own dataset even at one position.
    const members = ['1', '2'].map((echo) =>
      slice(0, { [Tags.AcquisitionNumber]: '1', [Tags.EchoNumbers]: echo })
    );

    const parts = splitOverlappingAcquisitions(members);

    expect(labels(parts)).toEqual(['echo 1', 'echo 2']);
    expect(parts.every((part) => !part.repeatedPositions)).toBe(true);
  });

  it('treats equivalent integer spellings as one tag value', () => {
    const merged = [...stack('+1', 0, 5), ...stack('01', 0, 5)].sort(
      byPosition
    );

    const parts = splitOverlappingAcquisitions(merged);

    expect(parts).toHaveLength(1);
    expect(parts[0].repeatedPositions).toBe(true);
  });

  it('does not split bilateral slabs whose stacks do not overlap', () => {
    // StackID (0020|9056) differs per slab, but the slabs form one sound
    // volume with a gap; this series is why StackID is not an axis.
    const parts = splitOverlappingAcquisitions(
      fixtureSlices(bilateralSagittalSlabs)
    );

    expect(parts).toHaveLength(1);
    expect(parts[0].repeatedPositions).toBe(false);
  });

  it('splits on acquisition when the temporal tag is partially present', () => {
    const parts = splitOverlappingAcquisitions(
      fixtureSlices(partialTemporalTags)
    );

    expect(labels(parts)).toEqual(
      ['1', '2', '3', '4', '5', '6', '7'].map((a) => `acquisition ${a}`)
    );
    expect(partLabelled(parts, 'acquisition 1').members).toHaveLength(72);
    expect(parts.every((part) => !part.repeatedPositions)).toBe(true);
  });

  it('keeps sequential timepoints merged', () => {
    const phase = (value: string, start: number, count: number) =>
      Array.from({ length: count }, (_, i) =>
        slice(start + i * 5, { [Tags.TemporalPositionIdentifier]: value })
      );

    const parts = splitOverlappingAcquisitions(
      [...phase('1', 0, 5), ...phase('2', 30, 5)].sort(byPosition)
    );

    expect(parts).toHaveLength(1);
  });

  it('splits a doubled acquisition and still flags the repetition', () => {
    const parts = splitOverlappingAcquisitions(
      fixtureSlices(doubledAcquisition)
    );

    expect(labels(parts)).toEqual(['acquisition 1', 'acquisition 2']);
    expect(partLabelled(parts, 'acquisition 1').members).toHaveLength(74);
    expect(partLabelled(parts, 'acquisition 1').repeatedPositions).toBe(false);
    expect(partLabelled(parts, 'acquisition 2').members).toHaveLength(148);
    expect(partLabelled(parts, 'acquisition 2').repeatedPositions).toBe(true);
  });

  it('recurses into each timepoint of a 4D multi-echo series', () => {
    // Synthetic: no IDC case observed with two active levels. Pins the
    // hierarchical key shape and label rendering.
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

    const parts = splitOverlappingAcquisitions(merged);

    expect(labels(parts)).toEqual([
      'phase 1, echo 1',
      'phase 1, echo 2',
      'phase 2, echo 1',
      'phase 2, echo 2',
    ]);
    expect(partLabelled(parts, 'phase 2, echo 1').parts).toEqual([
      ['acquisition', null],
      ['phase', '2'],
      ['echo', '1'],
      ['b-value', null],
    ]);
    parts.forEach((part) => {
      expect(part.members).toHaveLength(10);
    });
  });

  it('gives distinct values distinct key parts however they are spelled', () => {
    // A lossy encoder once mapped '1.5' and '1-5' to one suffix; the key
    // carries the normalized value itself, so no two values can collide.
    const merged = [...stack('1.5', 0, 5), ...stack('1-5', 0, 5)].sort(
      byPosition
    );

    const parts = splitOverlappingAcquisitions(merged);

    expect(labels(parts)).toEqual(['acquisition 1-5', 'acquisition 1.5']);
    expect(
      partValue(partLabelled(parts, 'acquisition 1-5'), 'acquisition')
    ).toBe('1-5');
  });
});
