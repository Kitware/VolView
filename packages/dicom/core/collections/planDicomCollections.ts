import { orientationsAgree } from './orientation';
import { groupBy } from './groupBy';
import { instanceKey } from './instanceKey';
import {
  splitOverlappingAcquisitions,
  type PositionOf,
} from './splitOverlappingAcquisitions';
import { projectOnNormal, sliceNormalOf } from './instanceFacts';
import {
  IN_PLANE_TOLERANCE_MM,
  reconstructInstances,
  type IrregularReason,
  type Reconstruction,
} from './reconstructVolume';

/**
 * Facts read once per instance from its metadata. Plain data: the planner
 * never sees a source, a store, or an itk-wasm task.
 */
export type InstanceFacts = {
  // Identity. Instances without a SOP Instance UID are never deduplicated.
  sopInstanceUid: string | null;
  seriesInstanceUid: string | null;

  // Acquisition descriptors split spatial stacks only where their ranges overlap.
  seriesNumber: string | null;
  sequenceName: string | null;
  sliceThickness: string | null;
  seriesDate: string | null;
  // Pixel shape must agree before slices can share an allocation.
  rows: string | null;
  columns: string | null;
  samplesPerPixel: string | null;
  numberOfFrames: string | null;

  // Geometry. Any of these may be unreadable.
  orientation: number[] | null;
  position: number[] | null;
  projectedPosition: number | null;
  pixelSpacing: number[] | null;
  /** Geometry of the frames within one instance. */
  frameReconstruction?: Reconstruction;

  // Ordering fallback.
  instanceNumber: number | null;

  // Semantic partition facts: what distinguishes one scan of a range from
  // another within a series. Normalized for equality.
  acquisitionNumber: string | null;
  temporalPositionIdentifier: string | null;
  echoNumbers: string | null;
  diffusionBValue: string | null;
};

export type CollectionKey = {
  seriesKey: string;
  parts: Array<[string, string | null]>;
};

export type DicomCollection = {
  key: CollectionKey;
  // Ordered by position when every one reads, else by instance number when
  // every one reads, else as given.
  members: InstanceFacts[];
  // The axes the members were ordered and judged on. Allocation must build
  // on these too, or the warnings describe a volume other than the one shown.
  orientation: number[] | null;
  reconstruction: Reconstruction;
  // Names the scan the collection was separated out as ('acquisition 2',
  // 'phase 3, echo 1'); null when nothing separated it from its series.
  label: string | null;
  // Conditions the user should hear about: the collection loads, but not as
  // the sound volume its series promised.
  warnings: string[];
};

type PlanInput = {
  seriesKey: string;
  instances: InstanceFacts[];
};

// The hard facts, in the order they appear in a collection key.
const HARD_FACT_RULES = [
  'rows',
  'columns',
  'samplesPerPixel',
  'numberOfFrames',
] as const;

const ORIENTATION_RULE = 'orientation';

const UNREADABLE_POSITION_LABEL = 'position unknown';

export const REPEATED_POSITIONS_WARNING =
  'holds repeated slice positions that no tag separates. Its slice spacing ' +
  'and measurements along the slice axis may be wrong.';

export const IRREGULAR_VOLUME_WARNING =
  'does not sample one regular volume: its slices are not evenly spaced on ' +
  'one grid. They were placed one slot apart in the order shown, so ' +
  'positions and measurements along the slice axis may be wrong.';

export const UNREADABLE_POSITION_WARNING =
  'holds slices whose position could not be read. They were kept out of the ' +
  'volumes of their series, and their order and spacing may be wrong.';

export const NONPARALLEL_SLICES_WARNING =
  'holds slices that are not parallel to one another. They were stacked on ' +
  'the axes most of them declare, so positions and measurements may be wrong.';

export const IN_PLANE_SHIFT_WARNING =
  'holds slices that are offset within their own plane from one to the next, ' +
  'as a tilted gantry produces. They were stacked without correcting for the ' +
  'offset, so positions and measurements across slices may be wrong.';

// A repeated or unreadable position makes a stack irregular too, and already
// carries a warning of its own.
const RECONSTRUCTION_WARNINGS: Record<IrregularReason, string[]> = {
  'unreadable-geometry': [],
  'repeated-position': [],
  'uneven-slice-spacing': [IRREGULAR_VOLUME_WARNING],
  'in-plane-shift': [IN_PLANE_SHIFT_WARNING],
  'mixed-pixel-spacing': [IRREGULAR_VOLUME_WARNING],
};

export const UNREADABLE_FRAME_GEOMETRY_WARNING =
  'holds frames whose spatial geometry could not be established. They were ' +
  'placed one slot apart in stored order, so positions and measurements ' +
  'along the slice axis may be wrong.';

const reconstructionWarnings = (
  reconstruction: Reconstruction,
  intraInstance: boolean
) => {
  if (reconstruction.kind === 'regular') return [];
  if (intraInstance && reconstruction.reason === 'unreadable-geometry')
    return [UNREADABLE_FRAME_GEOMETRY_WARNING];
  if (intraInstance && reconstruction.reason === 'repeated-position')
    return [REPEATED_POSITIONS_WARNING];
  return RECONSTRUCTION_WARNINGS[reconstruction.reason];
};

// Nulls sort last so a missing identity never becomes a bucket representative.
const compareUid = (left: string | null, right: string | null) => {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left < right ? -1 : 1;
};

const compareBySopUid = (left: InstanceFacts, right: InstanceFacts) =>
  compareUid(left.sopInstanceUid, right.sopInstanceUid);

const readableNumber = (value: number | null): value is number =>
  value !== null && Number.isFinite(value);

// Unreadable numbers sort last so they never win a tie-break.
const compareNumber = (left: number | null, right: number | null) => {
  if (!readableNumber(left)) return readableNumber(right) ? 1 : 0;
  if (!readableNumber(right)) return -1;
  return left === right ? 0 : left - right;
};

// Instances without a SOP Instance UID all tie on it, so their position and
// instance number keep the greedy orientation walk off input order.
const compareWalkOrder = (left: InstanceFacts, right: InstanceFacts) =>
  compareBySopUid(left, right) ||
  compareNumber(left.projectedPosition, right.projectedPosition) ||
  compareNumber(left.instanceNumber, right.instanceNumber);

const readableOrientation = (value: number[] | null): value is number[] =>
  value !== null &&
  value.length === 6 &&
  value.every((v) => Number.isFinite(v));

const orientationValue = (orientation: number[]) =>
  orientation.map(String).join(',');

// Ties go to the first given, so a walk ordered input decides them the same
// way whatever order the files arrived in.
const mostDeclared = (orientations: number[][]) => {
  const counts = new Map<string, number>();
  orientations.forEach((orientation) => {
    const value = orientationValue(orientation);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  const countOf = (orientation: number[]) =>
    counts.get(orientationValue(orientation)) as number;
  return orientations.reduce((best, orientation) =>
    countOf(orientation) > countOf(best) ? orientation : best
  );
};

/**
 * How far a member's far corner sits from where the volume axes put it, in
 * mm. A volume has one direction, so a slice leaning off it is resampled
 * nowhere: its samples are simply shown as if it did not lean.
 */
const leanOffAxes = (axes: number[], member: InstanceFacts) => {
  const { orientation } = member;
  if (!readableOrientation(orientation) || member.pixelSpacing === null)
    return 0;
  const [rowSpacing, columnSpacing] = member.pixelSpacing;
  const width = Number(member.columns) * columnSpacing;
  const height = Number(member.rows) * rowSpacing;
  return Math.hypot(
    ...[0, 1, 2].map(
      (i) =>
        width * (orientation[i] - axes[i]) +
        height * (orientation[i + 3] - axes[i + 3])
    )
  );
};

const nonparallel = (axes: number[] | null, members: InstanceFacts[]) =>
  axes !== null &&
  members.some((member) => leanOffAxes(axes, member) > IN_PLANE_TOLERANCE_MM);

const canonicalKey = (key: CollectionKey) =>
  JSON.stringify([key.seriesKey, key.parts]);

const hardFactSignature = (instance: InstanceFacts) =>
  JSON.stringify(HARD_FACT_RULES.map((rule) => instance[rule]));

const hardFactParts = (instance: InstanceFacts) =>
  HARD_FACT_RULES.map(
    (rule) => [rule, instance[rule]] as [string, string | null]
  );

const hardFactLabeler = (all: InstanceFacts[]) => {
  const rules = HARD_FACT_RULES.filter((rule) =>
    all.some((member) => member[rule] !== all[0][rule])
  );
  const names = {
    rows: 'rows',
    columns: 'columns',
    samplesPerPixel: 'components',
    numberOfFrames: 'frames',
  };
  return (instance: InstanceFacts) =>
    rules
      .map((rule) => `${names[rule]} ${instance[rule] ?? 'unknown'}`)
      .join(', ');
};

/**
 * Greedy bucketing walked in SOP Instance UID order, so the representative
 * whose cosines become the key, and the membership the greedy walk produces,
 * do not depend on input order.
 */
const bucketByOrientation = (instances: InstanceFacts[]) => {
  const references: number[][] = [];
  const bucketOf = new Map<InstanceFacts, number>();

  const walked = [...instances].sort(compareWalkOrder);
  walked.forEach((instance) => {
    const { orientation } = instance;
    if (!readableOrientation(orientation)) {
      bucketOf.set(instance, -1);
      return;
    }
    const found = references.findIndex((reference) =>
      orientationsAgree(reference, orientation)
    );
    bucketOf.set(
      instance,
      found >= 0 ? found : references.push(orientation) - 1
    );
  });

  // One normal for the whole bucket: two members agree within the tolerance,
  // so projecting each on its own cosines would spread one slice plane over
  // several positions. The reference stays the key, which a collection ID is
  // minted from; the axes are the ones most members declare, so a stray slice
  // that happens to be walked first does not lean every other one.
  const buckets = references.map((reference, index) => {
    const orientation = mostDeclared(
      walked
        .filter((instance) => bucketOf.get(instance) === index)
        .map((instance) => instance.orientation as number[])
    );
    return {
      value: orientationValue(reference) as string | null,
      orientation: orientation as number[] | null,
      normal: sliceNormalOf(orientation) as number[] | null,
      members: [] as InstanceFacts[],
    };
  });
  const unreadable = {
    value: null,
    orientation: null,
    normal: null,
    members: [] as InstanceFacts[],
  };

  instances.forEach((instance) => {
    const index = bucketOf.get(instance) ?? -1;
    const bucket = index === -1 ? unreadable : buckets[index];
    bucket.members.push(instance);
  });

  return unreadable.members.length > 0 ? [...buckets, unreadable] : buckets;
};

// A repeated position breaks on the instance number, keeping the scanner's
// own sequence for the tied members. Position stays primary: the allocator
// places slot i at origin + i * spacing along the normal, so any order that
// is not monotone in position mirrors or scrambles the volume.
const comparePosition =
  (positionOf: PositionOf) => (left: InstanceFacts, right: InstanceFacts) =>
    (positionOf(left) as number) - (positionOf(right) as number) ||
    compareNumber(left.instanceNumber, right.instanceNumber) ||
    compareWalkOrder(left, right);

const compareInstanceNumber = (left: InstanceFacts, right: InstanceFacts) =>
  (left.instanceNumber as number) - (right.instanceNumber as number) ||
  compareWalkOrder(left, right);

const orderMembers = (members: InstanceFacts[], positionOf: PositionOf) => {
  if (members.every((m) => readableNumber(positionOf(m))))
    return [...members].sort(comparePosition(positionOf));
  if (members.every((m) => readableNumber(m.instanceNumber)))
    return [...members].sort(compareInstanceNumber);
  return [...members];
};

// An unreadable position is named only beside a volume it was kept out of,
// and warned about there or where it leaves an order and spacing to guess.
const unreadablePositionNotes = (
  unreadable: boolean,
  placed: boolean,
  stacked: boolean
) => ({
  label: unreadable && placed ? UNREADABLE_POSITION_LABEL : null,
  warnings:
    unreadable && (placed || stacked) ? [UNREADABLE_POSITION_WARNING] : [],
});

export function planDicomCollections(input: PlanInput) {
  const { instances } = input;
  const labelHardFacts = hardFactLabeler(instances);

  const multiframe = (instance: InstanceFacts) =>
    Number(instance.numberOfFrames) > 1;
  const groups = [
    ...groupBy(
      instances.filter((instance) => !multiframe(instance)),
      hardFactSignature
    ).values(),
    ...instances.filter(multiframe).map((instance) => [instance]),
  ];
  const parts = groups
    .flatMap((group) =>
      bucketByOrientation(group).map((bucket) => ({
        group,
        bucket,
        positionOf: ((member) =>
          projectOnNormal(bucket.normal, member.position)) as PositionOf,
      }))
    )
    .flatMap(({ group, bucket, positionOf }) =>
      splitOverlappingAcquisitions(bucket.members, positionOf).map((part) => ({
        group,
        bucket,
        positionOf,
        part,
      }))
    );

  const placed = parts.some(({ part }) => !part.unreadablePositions);

  const collections = parts
    .map(({ group, bucket, positionOf, part }) => {
      const members = orderMembers(part.members, positionOf);
      const reconstruction = reconstructInstances(members, bucket.normal);
      const key: CollectionKey = {
        seriesKey: input.seriesKey,
        parts: [
          ...hardFactParts(group[0]),
          [ORIENTATION_RULE, bucket.value],
          ...part.parts,
          ...(multiframe(group[0])
            ? [['instance', instanceKey(group[0])] as [string, string]]
            : []),
        ],
      };
      const unreadable = unreadablePositionNotes(
        part.unreadablePositions,
        placed,
        members.length > 1
      );
      return {
        key,
        members,
        orientation: bucket.orientation,
        reconstruction,
        label:
          [labelHardFacts(group[0]), part.label, unreadable.label]
            .filter(Boolean)
            .join(', ') || null,
        warnings: [
          ...(part.repeatedPositions ? [REPEATED_POSITIONS_WARNING] : []),
          ...(multiframe(group[0]) ? [] : unreadable.warnings),
          ...reconstructionWarnings(
            reconstruction,
            members.length === 1 && !!members[0].frameReconstruction
          ),
          ...(nonparallel(bucket.orientation, members)
            ? [NONPARALLEL_SLICES_WARNING]
            : []),
        ],
      };
    })
    .sort((left, right) =>
      canonicalKey(left.key) < canonicalKey(right.key) ? -1 : 1
    );

  return collections;
}
