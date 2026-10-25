import { describe, expect, it } from 'vitest';
import { Tags } from '@/src/core/dicomTags';
import { readInstanceFacts } from '@/src/core/dicom/instanceFacts';
import { reconstructVolume } from '@/src/core/dicom/reconstructVolume';
import {
  bilateralSagittalSlabs,
  type IdcSeriesFixture,
} from '@/src/core/dicom/__tests__/idcSeriesFixtures';

// An axial slice at z, read through the fact reader so the fixtures stay in
// the tag vocabulary the real data uses.
const slice = (z: number, tags: Record<string, string> = {}) =>
  readInstanceFacts([
    ...Object.entries({
      [Tags.ImageOrientationPatient]: '1\\0\\0\\0\\1\\0',
      [Tags.ImagePositionPatient]: `0\\0\\${z}`,
      [Tags.PixelSpacing]: '0.5\\0.5',
      ...tags,
    }),
  ]);

const stack = (zs: number[]) => zs.map((z) => slice(z));

// A gantry tilted by theta leans the columns into z, so each slice plane sits
// sideways of the last as the table advances along z.
const tiltedSlice = (z: number, theta: number) =>
  slice(z, {
    [Tags.ImageOrientationPatient]: [
      1,
      0,
      0,
      0,
      Math.cos(theta),
      Math.sin(theta),
    ].join('\\'),
  });

const fixtureSlices = (fixture: IdcSeriesFixture) =>
  fixture
    .groups!.flatMap((group) => group.zs.map((z) => slice(z)))
    .sort(
      (left, right) =>
        (left.projectedPosition as number) - (right.projectedPosition as number)
    );

describe('reconstructVolume', () => {
  it('measures an evenly spaced stack and maps every member to its slot', () => {
    const result = reconstructVolume(stack([-10, -6, -2, 2, 6]));

    expect(result.kind).toBe('regular');
    expect(result.sliceSpacing).toBeCloseTo(4, 12);
    expect(result.slots).toEqual([0, 1, 2, 3, 4]);
  });

  it('derives the spacing from the endpoints once every gap matches', () => {
    const result = reconstructVolume(stack([0, 9, 18]));

    expect(result.kind).toBe('regular');
    expect(result.sliceSpacing).toBe(9);
  });

  it('has no spacing to derive from a single member', () => {
    const result = reconstructVolume(stack([7]));

    expect(result.kind).toBe('regular');
    expect(result.sliceSpacing).toBeNull();
    expect(result.slots).toEqual([0]);
  });

  // IDC series 1.3.6.1.4.1.14519.5.2.1.7009.2403.337074050757748643824459343650
  // ("WB_3D_NON-AC"): whole-body PET stepping by 3.27mm with the occasional
  // 3.35mm step from printing precision. One lattice, printed unevenly.
  it('accepts the printing jitter of quantized whole-body PET positions', () => {
    const result = reconstructVolume(stack([0, 3.27, 6.54, 9.89, 13.16]));

    expect(result.kind).toBe('regular');
    expect(result.sliceSpacing).toBeCloseTo(3.29, 2);
  });

  // The two slabs are 4mm stacks 42.439mm apart. Endpoint distance over slice
  // count would call that a 4.59mm lattice, which describes neither slab.
  it('calls the bilateral sagittal slabs an irregular stack', () => {
    const members = fixtureSlices(bilateralSagittalSlabs);

    const result = reconstructVolume(members);

    expect(members).toHaveLength(66);
    expect(result.kind).toBe('irregular');
    expect(result).toMatchObject({ reason: 'uneven-slice-spacing' });
    // The fallback places the slices at a gap the series actually holds.
    expect(result.sliceSpacing).toBeCloseTo(4, 12);
    expect(result.sliceSpacing).not.toBeCloseTo(4.59137, 4);
  });

  it('reports a hole in an otherwise even stack as irregular', () => {
    const result = reconstructVolume(stack([0, 4, 8, 20, 24]));

    expect(result).toMatchObject({
      kind: 'irregular',
      reason: 'uneven-slice-spacing',
    });
  });

  it('reports a repeated slice position as irregular', () => {
    const result = reconstructVolume(stack([0, 4, 4, 8]));

    expect(result).toMatchObject({
      kind: 'irregular',
      reason: 'repeated-position',
    });
  });

  it('reports a member whose position cannot be read as irregular', () => {
    const blind = readInstanceFacts([
      [Tags.ImageOrientationPatient, '1\\0\\0\\0\\1\\0'],
      [Tags.PixelSpacing, '0.5\\0.5'],
    ]);

    const result = reconstructVolume([...stack([0, 4]), blind]);

    expect(result).toMatchObject({
      kind: 'irregular',
      reason: 'unreadable-geometry',
    });
    expect(result.sliceSpacing).toBeNull();
  });

  it('reports a slice shifted within its own plane as irregular', () => {
    const shifted = readInstanceFacts([
      [Tags.ImageOrientationPatient, '1\\0\\0\\0\\1\\0'],
      [Tags.ImagePositionPatient, '0\\30\\8'],
      [Tags.PixelSpacing, '0.5\\0.5'],
    ]);

    const result = reconstructVolume([...stack([0, 4]), shifted]);

    expect(result).toMatchObject({
      kind: 'irregular',
      reason: 'in-plane-shift',
    });
    // The fallback is a step the members do take, not the one to the outlier.
    expect(result.sliceSpacing).toBeCloseTo(4, 12);
  });

  it('steps a tilted gantry stack by the distance its slices advance', () => {
    const theta = Math.PI / 9;

    const result = reconstructVolume(
      [0, 3, 6, 9].map((z) => tiltedSlice(z, theta))
    );

    expect(result).toMatchObject({
      kind: 'irregular',
      reason: 'in-plane-shift',
    });
    // The table stepped 3mm a slice, which is the extent ITK's series reader
    // keeps too; the shear is warned about, not folded into the spacing.
    expect(result.sliceSpacing).toBeCloseTo(3, 12);
    expect(result.slots).toEqual([0, 1, 2, 3]);
  });

  it('reports two in-plane sample spacings as irregular', () => {
    const coarse = slice(8, { [Tags.PixelSpacing]: '0.6\\0.6' });

    const result = reconstructVolume([...stack([0, 4]), coarse]);

    expect(result).toMatchObject({
      kind: 'irregular',
      reason: 'mixed-pixel-spacing',
    });
    expect(result.sliceSpacing).toBeCloseTo(4, 12);
  });

  it('steps a stack whose orientation cannot be read by its positions', () => {
    const blind = (z: number) =>
      readInstanceFacts([
        [Tags.ImagePositionPatient, `0\\0\\${z}`],
        [Tags.PixelSpacing, '0.5\\0.5'],
      ]);

    const result = reconstructVolume([0, 4, 8].map(blind));

    expect(result).toMatchObject({
      kind: 'irregular',
      reason: 'unreadable-geometry',
    });
    expect(result.sliceSpacing).toBeCloseTo(4, 12);
  });

  it('has no step for members that never move', () => {
    const result = reconstructVolume(stack([5, 5, 5]));

    expect(result).toMatchObject({
      kind: 'irregular',
      reason: 'repeated-position',
    });
    expect(result.sliceSpacing).toBeNull();
  });

  it('projects on the normal it is given rather than on the first member', () => {
    const members = stack([0, 4, 8]);

    // On the members' own normal the stack is even; on +x it steps sideways.
    expect(reconstructVolume(members).kind).toBe('regular');
    expect(reconstructVolume(members, [1, 0, 0])).toMatchObject({
      kind: 'irregular',
      reason: 'in-plane-shift',
    });
  });
});
