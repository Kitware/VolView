import type { Chunk } from '@/src/core/streaming/chunk';
import { Tags } from '@/src/core/dicomTags';
import {
  hasDuplicateSlicePositions,
  splitOverlappingAcquisitions,
} from '@/src/utils/dicom/splitOverlappingAcquisitions';
import {
  bilateralSagittalSlabs,
  dceEightPhase,
  dceSevenPhasePhilips,
  dixonDualEcho,
  dixonUnevenEchoes,
  doubledAcquisition,
  partialTemporalTags,
  type IdcSeriesFixture,
} from '@/src/utils/dicom/__tests__/idcSeriesFixtures';
import { describe, it, expect } from 'vitest';

function chunk(z: number, overrides: Record<string, string> = {}) {
  const metadata = {
    [Tags.ImageOrientationPatient]: '1\\0\\0\\0\\1\\0',
    [Tags.ImagePositionPatient]: `0\\0\\${z}`,
    ...overrides,
  };
  return { metadata: Object.entries(metadata) } as unknown as Chunk;
}

// A stack of `count` slices starting at `start`, tagged with an acquisition.
function stack(acquisition: string, start: number, count: number, step = 2.5) {
  return Array.from({ length: count }, (_, i) =>
    chunk(start + i * step, { [Tags.AcquisitionNumber]: acquisition })
  );
}

const zOf = (c: Chunk) =>
  Number(new Map(c.metadata!).get(Tags.ImagePositionPatient)!.split('\\')[2]);
const byPosition = (a: Chunk, b: Chunk) => zOf(a) - zOf(b);

// Chunks mirroring a real IDC series recorded in idcSeriesFixtures.ts.
const fixtureChunks = (fixture: IdcSeriesFixture) =>
  fixture
    .groups!.flatMap((group) => group.zs.map((z) => chunk(z, group.tags)))
    .sort(byPosition);

describe('hasDuplicateSlicePositions', () => {
  it('is false for distinct positions', () => {
    expect(hasDuplicateSlicePositions([0, 2.5, 5].map((z) => chunk(z)))).toBe(
      false
    );
  });

  it('is true when two slices share a position', () => {
    expect(
      hasDuplicateSlicePositions([0, 2.5, 2.5, 5].map((z) => chunk(z)))
    ).toBe(true);
  });

  it('says nothing about geometry it cannot read', () => {
    const noOrientation = [0, 0].map((z) => ({
      metadata: [[Tags.ImagePositionPatient, `0\\0\\${z}`]],
    })) as unknown as Chunk[];
    expect(hasDuplicateSlicePositions(noOrientation)).toBe(false);
  });
});

describe('splitOverlappingAcquisitions', () => {
  it('passes a single-acquisition volume through untouched', () => {
    const chunks = stack('1', 0, 5);
    const { volumes, duplicated, labels } = splitOverlappingAcquisitions({
      vol: chunks,
    });

    expect(duplicated).toEqual([]);
    expect(labels).toEqual({});
    expect(Object.keys(volumes)).toEqual(['vol']);
    expect(volumes.vol).toBe(chunks);
  });

  it('separates overlapping acquisitions merged into one series', () => {
    // The reference bug, IDC series
    // 1.3.6.1.4.1.14519.5.2.1.3098.5025.295130953269492004748715270821
    // ("ST+ N15/12/17 A30/20/40"): three overlapping 2.5mm passes that merged
    // into one 447-slice volume at a fabricated 1.478mm spacing.
    const acq1 = stack('1', -20, 5);
    const acq2 = stack('2', -19.25, 6);
    const acq3 = stack('3', -18.5, 4);
    const merged = [...acq1, ...acq2, ...acq3].sort(byPosition);

    const { volumes, duplicated, labels } = splitOverlappingAcquisitions({
      vol: merged,
    });

    expect(duplicated).toEqual([]);
    expect(Object.keys(volumes).sort()).toEqual(['vol.1', 'vol.2', 'vol.3']);
    expect(volumes['vol.1']).toEqual(acq1);
    expect(volumes['vol.2']).toEqual(acq2);
    expect(volumes['vol.3']).toEqual(acq3);
    expect(labels).toEqual({
      'vol.1': 'acquisition 1',
      'vol.2': 'acquisition 2',
      'vol.3': 'acquisition 3',
    });
  });

  it('keeps acquisitions that follow one another together', () => {
    // IDC series
    // 1.3.6.1.4.1.14519.5.2.1.7009.2403.262533307142705262678914598920
    // ("Recon 2: CHEST"): one continuous 5mm stack whose slices carry three
    // acquisition numbers, with a 30mm hole where slices are missing. Uneven
    // spacing is not a reason to tear the scans apart.
    const acq3 = stack('3', -320.25, 4, 5);
    const acq2 = stack('2', -300.25, 6, 5);
    const acq1 = stack('1', -245.25, 56, 5);
    const merged = [...acq3, ...acq2, ...acq1].sort(byPosition);

    const { volumes, duplicated } = splitOverlappingAcquisitions({
      vol: merged,
    });

    expect(Object.keys(volumes)).toEqual(['vol']);
    expect(volumes.vol).toBe(merged);
    expect(duplicated).toEqual([]);
  });

  it('leaves a long run of sequential acquisitions merged', () => {
    // IDC series
    // 1.3.6.1.4.1.14519.5.2.1.3320.3273.243812674588352758771557518364:
    // acquisitions numbered 20 through 36 across one evenly spaced stack.
    const groups = Array.from({ length: 17 }, (_, i) =>
      stack(String(20 + i), i * 25, 10)
    );
    const merged = groups.flat().sort(byPosition);

    const { volumes } = splitOverlappingAcquisitions({ vol: merged });

    expect(Object.keys(volumes)).toEqual(['vol']);
  });

  it('tolerates quantized whole-body PET positions', () => {
    // IDC series
    // 1.3.6.1.4.1.14519.5.2.1.7009.2403.337074050757748643824459343650
    // ("WB_3D_NON-AC"): whole-body PET stepping by 3.27mm with the occasional
    // 3.35mm step from printing precision. One acquisition, nothing to
    // separate.
    const zs = [0, 3.27, 6.54, 9.89, 13.16, 16.43];
    const chunks = zs.map((z) => chunk(z, { [Tags.AcquisitionNumber]: '1' }));

    const { volumes, duplicated } = splitOverlappingAcquisitions({
      vol: chunks,
    });

    expect(Object.keys(volumes)).toEqual(['vol']);
    expect(duplicated).toEqual([]);
  });

  it('separates repeat scans taken at one position', () => {
    // IDC series
    // 1.3.6.1.4.1.14519.5.2.1.7009.2403.668914995861790731496154478744
    // ("Smart Prep Series"), bolus tracking: seven scans of the same slice,
    // one acquisition each. Merged it would be a bogus seven-slice volume.
    const chunks = Array.from({ length: 7 }, (_, i) =>
      chunk(-82.89, { [Tags.AcquisitionNumber]: String(i + 1) })
    );

    const { volumes, duplicated } = splitOverlappingAcquisitions({
      vol: chunks,
    });

    expect(Object.keys(volumes).length).toBe(7);
    expect(duplicated).toEqual([]);
  });

  it('separates scans that share a boundary slice', () => {
    const lower = stack('1', 0, 4);
    const upper = stack('2', 7.5, 4);
    const merged = [...lower, ...upper].sort(byPosition);

    const { volumes } = splitOverlappingAcquisitions({ vol: merged });

    expect(Object.keys(volumes).sort()).toEqual(['vol.1', 'vol.2']);
  });

  it('does not separate scans that abut without overlapping', () => {
    const lower = stack('1', 0, 4);
    const upper = stack('2', 10, 4);
    const merged = [...lower, ...upper].sort(byPosition);

    const { volumes } = splitOverlappingAcquisitions({ vol: merged });

    expect(Object.keys(volumes)).toEqual(['vol']);
  });

  it('reports repeated positions no tag separates', () => {
    const chunks = [0, 2.5, 2.5, 5].map((z) =>
      chunk(z, { [Tags.AcquisitionNumber]: '1' })
    );
    const { volumes, duplicated } = splitOverlappingAcquisitions({
      vol: chunks,
    });

    expect(Object.keys(volumes)).toEqual(['vol']);
    expect(duplicated).toEqual(['vol']);
  });

  it('ignores slices with no acquisition number', () => {
    const chunks = [0, 2.5, 5, 6.25, 8.75].map((z) => chunk(z));
    const { volumes, duplicated } = splitOverlappingAcquisitions({
      vol: chunks,
    });

    expect(Object.keys(volumes)).toEqual(['vol']);
    expect(duplicated).toEqual([]);
  });

  it('keeps each group in slice order', () => {
    const acq1 = stack('1', -20, 5);
    const acq2 = stack('2', -19.25, 6);
    const merged = [...acq1, ...acq2].sort(byPosition);

    const { volumes } = splitOverlappingAcquisitions({ vol: merged });

    Object.values(volumes).forEach((group) => {
      expect(group).toEqual([...group].sort(byPosition));
    });
  });

  it('handles several volumes independently', () => {
    const good = stack('1', 0, 4);
    const acqA = stack('1', -20, 5);
    const acqB = stack('2', -19.25, 6);

    const { volumes } = splitOverlappingAcquisitions({
      good,
      mixed: [...acqA, ...acqB].sort(byPosition),
    });

    expect(Object.keys(volumes).sort()).toEqual(['good', 'mixed.1', 'mixed.2']);
  });

  it('encodes non-alphanumeric tag values into the volume id', () => {
    const acq1 = stack('1.5', -20, 5);
    const acq2 = stack('2.5', -19.25, 6);

    const { volumes } = splitOverlappingAcquisitions({
      vol: [...acq1, ...acq2].sort(byPosition),
    });

    expect(Object.keys(volumes).sort()).toEqual(['vol.1D5', 'vol.2D5']);
  });
});

describe('splitOverlappingAcquisitions temporal and echo discriminators', () => {
  it('separates DCE timepoints that re-scan one range', () => {
    const merged = fixtureChunks(dceEightPhase);

    const { volumes, duplicated, labels } = splitOverlappingAcquisitions({
      vol: merged,
    });

    expect(Object.keys(volumes).sort()).toEqual(
      ['0', '1', '2', '3', '4', '5', '6', '7'].map((p) => `vol.${p}`)
    );
    expect(duplicated).toEqual([]);
    expect(labels['vol.0']).toBe('phase 0');
    expect(volumes['vol.3']).toHaveLength(80);
  });

  it('separates timepoints across vendors and 1-based numbering', () => {
    const merged = fixtureChunks(dceSevenPhasePhilips);

    const { volumes, duplicated } = splitOverlappingAcquisitions({
      vol: merged,
    });

    expect(Object.keys(volumes)).toHaveLength(7);
    expect(duplicated).toEqual([]);
    Object.values(volumes).forEach((group) => {
      expect(group).toHaveLength(158);
    });
  });

  it('separates Dixon echoes that nothing else distinguishes', () => {
    const merged = fixtureChunks(dixonDualEcho);

    const { volumes, duplicated, labels } = splitOverlappingAcquisitions({
      vol: merged,
    });

    expect(Object.keys(volumes).sort()).toEqual(['vol.1', 'vol.2']);
    expect(labels['vol.1']).toBe('echo 1');
    expect(labels['vol.2']).toBe('echo 2');
    expect(duplicated).toEqual([]);
  });

  it('separates echoes with unequal slice counts', () => {
    const merged = fixtureChunks(dixonUnevenEchoes);

    const { volumes } = splitOverlappingAcquisitions({ vol: merged });

    expect(volumes['vol.1']).toHaveLength(13);
    expect(volumes['vol.2']).toHaveLength(12);
  });

  it('does not split bilateral slabs whose stacks do not overlap', () => {
    // StackID (0020|9056) differs per slab, but the slabs form one sound
    // volume with a gap; this series is why StackID is not a discriminator.
    const merged = fixtureChunks(bilateralSagittalSlabs);

    const { volumes, duplicated } = splitOverlappingAcquisitions({
      vol: merged,
    });

    expect(Object.keys(volumes)).toEqual(['vol']);
    expect(duplicated).toEqual([]);
  });

  it('splits on acquisition when the temporal tag is partially present', () => {
    const merged = fixtureChunks(partialTemporalTags);

    const { volumes, duplicated } = splitOverlappingAcquisitions({
      vol: merged,
    });

    expect(Object.keys(volumes).sort()).toEqual(
      ['1', '2', '3', '4', '5', '6', '7'].map((a) => `vol.${a}`)
    );
    expect(volumes['vol.1']).toHaveLength(72);
    expect(duplicated).toEqual([]);
  });

  it('keeps sequential timepoints merged', () => {
    const phase = (value: string, start: number, count: number) =>
      Array.from({ length: count }, (_, i) =>
        chunk(start + i * 5, { [Tags.TemporalPositionIdentifier]: value })
      );
    const merged = [...phase('1', 0, 5), ...phase('2', 30, 5)].sort(byPosition);

    const { volumes } = splitOverlappingAcquisitions({ vol: merged });

    expect(Object.keys(volumes)).toEqual(['vol']);
  });

  it('splits a doubled acquisition and still warns on it', () => {
    const merged = fixtureChunks(doubledAcquisition);

    const { volumes, duplicated } = splitOverlappingAcquisitions({
      vol: merged,
    });

    expect(Object.keys(volumes).sort()).toEqual(['vol.1', 'vol.2']);
    expect(volumes['vol.1']).toHaveLength(74);
    expect(volumes['vol.2']).toHaveLength(148);
    expect(duplicated).toEqual(['vol.2']);
  });

  it('recurses into each timepoint of a 4D multi-echo series', () => {
    // Synthetic: no IDC case observed with two active levels. Pins the
    // hierarchical ID shape and label rendering.
    const merged = ['1', '2']
      .flatMap((phase) =>
        ['1', '2'].flatMap((echo) =>
          Array.from({ length: 10 }, (_, i) =>
            chunk(i * 2, {
              [Tags.AcquisitionNumber]: '1',
              [Tags.TemporalPositionIdentifier]: phase,
              [Tags.EchoNumbers]: echo,
            })
          )
        )
      )
      .sort(byPosition);

    const { volumes, labels } = splitOverlappingAcquisitions({ vol: merged });

    expect(Object.keys(volumes).sort()).toEqual([
      'vol.1.1',
      'vol.1.2',
      'vol.2.1',
      'vol.2.2',
    ]);
    expect(labels['vol.2.1']).toBe('phase 2, echo 1');
    Object.values(volumes).forEach((group) => {
      expect(group).toHaveLength(10);
    });
  });

  it('falls back unsplit when tag values collide into one ID', () => {
    // '+1' and '-1' both encode to 'D1'; splitting would silently drop one
    // group's chunks, so the volume must pass through whole and be reported.
    const merged = [...stack('+1', 0, 5), ...stack('-1', 0, 5)].sort(
      byPosition
    );

    const { volumes, duplicated, collided } = splitOverlappingAcquisitions({
      vol: merged,
    });

    expect(Object.keys(volumes)).toEqual(['vol']);
    expect(collided).toEqual(['vol']);
    expect(duplicated).toEqual(['vol']);
    expect(volumes.vol).toHaveLength(10);
  });
});
