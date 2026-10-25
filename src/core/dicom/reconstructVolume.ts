import type { InstanceFacts } from '@/src/core/dicom/planDicomCollections';
import { projectOnNormal, sliceNormalOf } from '@/src/core/dicom/instanceFacts';

/** The geometry a reconstruction judges. Nothing else about an instance. */
export type ReconstructionMember = Pick<
  InstanceFacts,
  'orientation' | 'position' | 'pixelSpacing'
>;

export type IrregularReason =
  | 'unreadable-geometry'
  | 'repeated-position'
  | 'uneven-slice-spacing'
  | 'in-plane-shift'
  | 'mixed-pixel-spacing';

/**
 * What the members can be reconstructed as.
 *
 * `regular` means every consecutive pair of slice planes is the same distance
 * apart and the members share one in-plane grid, so member i belongs at slot
 * `slots[i]` of a volume sampled at `sliceSpacing`. `irregular` means they do
 * not: the members still load, placed one slot apart at the step the stack
 * does take, but no lattice describes where they actually are.
 *
 * A slice spacing of null means there is nothing to derive one from, which one
 * member alone always is.
 */
export type Reconstruction =
  | { kind: 'regular'; sliceSpacing: number | null; slots: number[] }
  | {
      kind: 'irregular';
      reason: IrregularReason;
      sliceSpacing: number | null;
      slots: number[];
    };

/**
 * How far apart two slice gaps may be and still be one lattice: a tenth of a
 * millimetre, or one part in a hundred of the gap, whichever is larger. DICOM
 * prints a position as a decimal string, so the projection of an oblique stack
 * onto its normal jitters in the last digits; a genuine slab boundary or a
 * missed slice is orders of magnitude larger.
 */
export const SLICE_SPACING_TOLERANCE_MM = 0.1;
export const SLICE_SPACING_RELATIVE_TOLERANCE = 0.01;

/** How far a slice may sit from the in-plane origin of the first, in mm. */
export const IN_PLANE_TOLERANCE_MM = 0.1;

/** How far two in-plane sample spacings may differ and still be one grid. */
export const PIXEL_SPACING_TOLERANCE_MM = 1e-4;

const spacingTolerance = (gap: number) =>
  Math.max(
    SLICE_SPACING_TOLERANCE_MM,
    Math.abs(gap) * SLICE_SPACING_RELATIVE_TOLERANCE
  );

// Lower median, so the fallback spacing of an irregular stack is one of its
// own gaps rather than an average of a gap and a hole.
const median = (values: number[]) =>
  [...values].sort((left, right) => left - right)[
    Math.floor((values.length - 1) / 2)
  ];

const subtract = (left: number[], right: number[]) =>
  left.map((value, index) => value - right[index]);

const scale = (vector: number[], factor: number) =>
  vector.map((value) => value * factor);

const maxAbs = (values: number[]) =>
  values.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0);

const distance = (left: number[], right: number[]) =>
  Math.sqrt(
    subtract(left, right).reduce((sum, value) => sum + value * value, 0)
  );

/**
 * The step a stack that is no lattice still takes: the lower median of the
 * straight-line distance from each member to the next, in the order given.
 * That is what ITK's series reader steps by, so a tilted gantry's slices,
 * whose planes shift sideways as they advance, keep the extent they were
 * scanned over. Null when a position is unreadable or the members never move.
 */
const positionStep = (members: ReconstructionMember[]) => {
  const positions = members.map((member) => member.position);
  if (positions.length < 2 || positions.some((position) => position === null))
    return null;
  const gaps = positions
    .slice(1)
    .map((position, index) =>
      distance(position as number[], positions[index] as number[])
    );
  const step = median(gaps);
  return step > 0 ? step : null;
};

// A member with no pixel spacing at all is unknown, not different: only two
// spacings that both read and disagree describe two grids.
const mixedPixelSpacing = (members: ReconstructionMember[]) => {
  const spacings = members
    .map((member) => member.pixelSpacing)
    .filter((spacing): spacing is number[] => spacing !== null);
  return spacings.some(
    (spacing) =>
      maxAbs(subtract(spacing, spacings[0])) > PIXEL_SPACING_TOLERANCE_MM
  );
};

const irregular = (
  reason: IrregularReason,
  sliceSpacing: number | null,
  count: number
): Reconstruction => ({
  kind: 'irregular',
  reason,
  sliceSpacing,
  slots: Array.from({ length: count }, (_, index) => index),
});

const inPlaneShifted = (
  members: ReconstructionMember[],
  axis: number[],
  along: number[]
) => {
  const inPlaneOf = (index: number) =>
    subtract(members[index].position as number[], scale(axis, along[index]));
  const origin = inPlaneOf(0);
  return members.some(
    (_member, index) =>
      maxAbs(subtract(inPlaneOf(index), origin)) > IN_PLANE_TOLERANCE_MM
  );
};

/** What stops these members from describing a volume at all, if anything. */
const geometryFault = (
  members: ReconstructionMember[],
  axis: number[] | null,
  along: Array<number | null>
): IrregularReason | null => {
  if (along.some((position) => !Number.isFinite(position)))
    return 'unreadable-geometry';
  if (mixedPixelSpacing(members)) return 'mixed-pixel-spacing';
  if (inPlaneShifted(members, axis as number[], along as number[]))
    return 'in-plane-shift';
  return null;
};

/** The lattice the slice planes sit on, once they are known to be readable. */
const lattice = (along: number[]): Reconstruction => {
  if (along.length < 2)
    return { kind: 'regular', sliceSpacing: null, slots: [0] };

  const gaps = along.slice(1).map((position, index) => position - along[index]);
  const step = median(gaps);
  const count = along.length;

  if (gaps.some((gap) => gap <= 0))
    return irregular('repeated-position', step > 0 ? step : null, count);
  if (gaps.some((gap) => Math.abs(gap - step) > spacingTolerance(step)))
    return irregular('uneven-slice-spacing', step, count);

  // Every gap matches, so the endpoints fit the members better than any single
  // printed gap does.
  const sliceSpacing = (along[count - 1] - along[0]) / gaps.length;
  const slots = along.map((position) =>
    Math.round((position - along[0]) / sliceSpacing)
  );
  return slots.some((slot, index) => slot !== index)
    ? irregular('uneven-slice-spacing', step, count)
    : { kind: 'regular', sliceSpacing, slots };
};

/**
 * Whether the members sit on one sampled volume, and where each one belongs in
 * it. Pure: the members are judged by their own geometry, in the order given.
 *
 * `normal` is the slice normal the positions are projected on. The planner
 * passes the one normal its orientation bucket agreed on; without it, the
 * first member's own cosines decide.
 */
export function reconstructVolume(
  members: ReconstructionMember[],
  normal?: number[] | null
): Reconstruction {
  if (members.length === 0)
    return { kind: 'regular', sliceSpacing: null, slots: [] };

  const axis = normal ?? sliceNormalOf(members[0].orientation);
  const along = members.map((member) => projectOnNormal(axis, member.position));

  const fault = geometryFault(members, axis, along);
  return fault === null
    ? lattice(along as number[])
    : irregular(fault, positionStep(members), members.length);
}
