import { orientationsAgree } from './orientation';
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
 * Facts read once per instance from a chunk's metadata. Plain data: the planner
 * never sees a Chunk, a store, or an itk-wasm task.
 */
export type InstanceFacts = {
  // Identity. Instances without a SOP Instance UID are never deduplicated.
  sopInstanceUid: string | null;
  seriesInstanceUid: string | null;

  // Hard partition facts, compared for equality.
  seriesNumber: string | null;
  sequenceName: string | null;
  sliceThickness: string | null;
  seriesDate: string | null;
  rows: string | null;
  columns: string | null;
  samplesPerPixel: string | null;
  numberOfFrames: string | null;

  // Geometry. Any of these may be unreadable.
  orientation: number[] | null;
  position: number[] | null;
  projectedPosition: number | null;
  pixelSpacing: number[] | null;
  /** Intra-instance frame geometry; slots still index source chunks. */
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

export type MemberOrder = 'spatial' | 'instance-number' | 'input';

export type DicomCollection = {
  key: CollectionKey;
  members: InstanceFacts[];
  order: MemberOrder;
  // The axes the members were ordered and judged on. Allocation must build
  // on these too, or the warnings describe a volume other than the one shown.
  orientation: number[] | null;
  reconstruction: Reconstruction;
  // Names the scan the collection was separated out as ('acquisition 2',
  // 'phase 3, echo 1'); null when nothing separated it from its series.
  label: string | null;
  // Per-member notes about how the plan was reached.
  diagnostics: string[];
  // Conditions the user should hear about: the collection loads, but not as
  // the sound volume its series promised.
  warnings: string[];
};

export type DicomCollectionPlan = {
  collections: DicomCollection[];
};

export type PlanInput = {
  seriesKey: string;
  instances: InstanceFacts[];
};

export { ORIENTATION_TOLERANCE } from './orientation';

// The hard facts, in the order they appear in a collection key.
export const HARD_FACT_RULES = [
  'seriesNumber',
  'sequenceName',
  'sliceThickness',
  'seriesDate',
  'rows',
  'columns',
  'samplesPerPixel',
  'numberOfFrames',
] as const;

export const ORIENTATION_RULE = 'orientation';

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

const ANONYMOUS = 'an instance with no SOP Instance UID';

const label = (instance: InstanceFacts) =>
  instance.sopInstanceUid === null
    ? ANONYMOUS
    : `instance ${instance.sopInstanceUid}`;

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

const compareText = (left: string, right: string) => {
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

// Unreadable numbers sort last so they never win a tie-break.
const compareNumber = (left: number | null, right: number | null) => {
  if (!readableNumber(left)) return readableNumber(right) ? 1 : 0;
  if (!readableNumber(right)) return -1;
  return left === right ? 0 : left - right;
};

// JSON collapses NaN and Infinity onto null; keep them apart so the signature
// below separates every pair of unequal instances.
const encodeFact = (_key: string, value: unknown) =>
  typeof value === 'number' && !Number.isFinite(value) ? String(value) : value;

const contentSignature = (instance: InstanceFacts) =>
  JSON.stringify(
    [
      instance.sopInstanceUid,
      instance.seriesInstanceUid,
      ...HARD_FACT_RULES.map((rule) => instance[rule]),
      instance.orientation,
      instance.position,
      instance.projectedPosition,
      instance.pixelSpacing,
      instance.frameReconstruction,
      instance.instanceNumber,
    ],
    encodeFact
  );

/**
 * Total order over instances that share a SOP Instance UID comparison, which
 * happens whenever two instances both lack one.
 */
const compareByContent = (left: InstanceFacts, right: InstanceFacts) =>
  compareText(
    JSON.stringify(left.orientation),
    JSON.stringify(right.orientation)
  ) ||
  compareNumber(left.projectedPosition, right.projectedPosition) ||
  compareNumber(left.instanceNumber, right.instanceNumber) ||
  compareText(contentSignature(left), contentSignature(right));

// Sorting on the UID alone ties every anonymous instance, leaving the greedy
// orientation walk at the mercy of input order.
const compareWalkOrder = (left: InstanceFacts, right: InstanceFacts) =>
  compareBySopUid(left, right) || compareByContent(left, right);

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
  if (!readableOrientation(orientation)) return 0;
  const [rowSpacing, columnSpacing] = member.pixelSpacing ?? [1, 1];
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

/** Last occurrence of a SOP Instance UID wins, so the newest batch survives. */
const dedupe = (instances: InstanceFacts[]) => {
  const lastIndex = new Map<string, number>();
  instances.forEach((instance, index) => {
    if (instance.sopInstanceUid !== null)
      lastIndex.set(instance.sopInstanceUid, index);
  });

  const kept = instances.filter(
    (instance, index) =>
      instance.sopInstanceUid === null ||
      lastIndex.get(instance.sopInstanceUid) === index
  );

  const droppedCounts = new Map<string, number>();
  instances.forEach((instance, index) => {
    const uid = instance.sopInstanceUid;
    if (uid === null || lastIndex.get(uid) === index) return;
    droppedCounts.set(uid, (droppedCounts.get(uid) ?? 0) + 1);
  });

  const diagnostics = new Map<InstanceFacts, string>();
  kept.forEach((instance) => {
    const uid = instance.sopInstanceUid;
    const dropped = uid === null ? 0 : (droppedCounts.get(uid) ?? 0);
    if (dropped > 0)
      diagnostics.set(
        instance,
        `dropped ${dropped} earlier copy of instance ${uid}`
      );
  });

  return { kept, diagnostics };
};

const hardFactSignature = (instance: InstanceFacts) =>
  JSON.stringify(HARD_FACT_RULES.map((rule) => instance[rule]));

const hardFactParts = (instance: InstanceFacts) =>
  HARD_FACT_RULES.map(
    (rule) => [rule, instance[rule]] as [string, string | null]
  );

/** Groups preserve input order, both of the groups and of their members. */
const groupBy = (
  instances: InstanceFacts[],
  signature: (instance: InstanceFacts) => string
) => {
  const groups = new Map<string, InstanceFacts[]>();
  instances.forEach((instance) => {
    const id = signature(instance);
    const existing = groups.get(id);
    if (existing) existing.push(instance);
    else groups.set(id, [instance]);
  });
  return [...groups.values()];
};

/**
 * Greedy bucketing walked in SOP Instance UID then content order, so the
 * representative whose cosines become the key, and the membership the greedy
 * walk produces, do not depend on input order.
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
// is not monotone in position mirrors or scrambles the volume. Anonymous
// members that still tie order by content rather than by input position.
const comparePosition =
  (positionOf: PositionOf) => (left: InstanceFacts, right: InstanceFacts) =>
    (positionOf(left) as number) - (positionOf(right) as number) ||
    compareNumber(left.instanceNumber, right.instanceNumber) ||
    compareWalkOrder(left, right);

const compareInstanceNumber = (left: InstanceFacts, right: InstanceFacts) =>
  (left.instanceNumber as number) - (right.instanceNumber as number) ||
  compareWalkOrder(left, right);

/** Never inherits input order silently: the order actually used is recorded. */
const orderMembers = (members: InstanceFacts[], positionOf: PositionOf) => {
  const numbered = members.every((m) => readableNumber(m.instanceNumber));

  if (members.every((m) => readableNumber(positionOf(m))))
    return {
      members: [...members].sort(comparePosition(positionOf)),
      order: 'spatial' as MemberOrder,
      diagnostics: [] as string[],
    };

  const positionless = (ordered: InstanceFacts[]) =>
    ordered
      .filter((m) => !readableNumber(positionOf(m)))
      .map((m) => `${label(m)} has no readable position`);

  if (numbered) {
    const ordered = [...members].sort(compareInstanceNumber);
    return {
      members: ordered,
      order: 'instance-number' as MemberOrder,
      diagnostics: positionless(ordered),
    };
  }

  return {
    members: [...members],
    order: 'input' as MemberOrder,
    diagnostics: [
      ...positionless(members),
      ...members
        .filter((m) => !readableNumber(m.instanceNumber))
        .map((m) => `${label(m)} has no readable instance number`),
    ],
  };
};

/** Occurrences per instance, so an input holding one object twice needs two. */
const tally = (instances: InstanceFacts[]) => {
  const counts = new Map<InstanceFacts, number>();
  instances.forEach((instance) =>
    counts.set(instance, (counts.get(instance) ?? 0) + 1)
  );
  return counts;
};

/**
 * Throws when the collections do not hold every instance as many times as the
 * input does, when they hold one the input never gave, or when two collections
 * share a key.
 */
export function validateCollections(
  instances: InstanceFacts[],
  collections: DicomCollection[]
) {
  const expected = tally(instances);
  const placed = tally(collections.flatMap((collection) => collection.members));

  expected.forEach((count, instance) => {
    const found = placed.get(instance) ?? 0;
    if (found === count) return;
    if (found === 0)
      throw new Error(`${label(instance)} landed in no collection`);
    throw new Error(
      `${label(instance)} landed in ${found} collections, expected ${count}`
    );
  });

  placed.forEach((_count, instance) => {
    if (!expected.has(instance))
      throw new Error(
        `${label(instance)} landed in a collection without being an input`
      );
  });

  const seen = new Set<string>();
  collections.forEach((collection) => {
    const encoded = canonicalKey(collection.key);
    if (seen.has(encoded))
      throw new Error(`two collections share the key ${encoded}`);
    seen.add(encoded);
  });
}

export function planDicomCollections(input: PlanInput) {
  const { kept, diagnostics: dedupeDiagnostics } = dedupe(input.instances);

  const multiframe = (instance: InstanceFacts) =>
    Number(instance.numberOfFrames) > 1;
  const groups = [
    ...groupBy(
      kept.filter((instance) => !multiframe(instance)),
      hardFactSignature
    ),
    ...kept.filter(multiframe).map((instance) => [instance]),
  ];
  const planned = groups
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
    )
    .map(({ group, bucket, positionOf, part }) => {
      const ordered = orderMembers(part.members, positionOf);
      const reconstruction = reconstructInstances(
        ordered.members,
        bucket.normal
      );
      const key: CollectionKey = {
        seriesKey: input.seriesKey,
        parts: [
          ...hardFactParts(group[0]),
          [ORIENTATION_RULE, bucket.value],
          ...part.parts,
          ...(multiframe(group[0])
            ? [
                [
                  'instance',
                  group[0].sopInstanceUid ?? String(kept.indexOf(group[0])),
                ] as [string, string],
              ]
            : []),
        ],
      };
      return {
        key,
        members: ordered.members,
        order: ordered.order,
        orientation: bucket.orientation,
        reconstruction,
        label: part.label,
        diagnostics: [
          ...ordered.members.flatMap((member) => {
            const dropped = dedupeDiagnostics.get(member);
            return dropped ? [dropped] : [];
          }),
          ...(bucket.value === null
            ? ordered.members.map(
                (member) => `${label(member)} has no readable orientation`
              )
            : []),
          ...ordered.diagnostics,
        ],
        warnings: [
          ...(part.repeatedPositions ? [REPEATED_POSITIONS_WARNING] : []),
          ...(part.unreadablePositions && !multiframe(group[0])
            ? [UNREADABLE_POSITION_WARNING]
            : []),
          ...reconstructionWarnings(
            reconstruction,
            ordered.members.length === 1 &&
              !!ordered.members[0].frameReconstruction
          ),
          ...(nonparallel(bucket.orientation, ordered.members)
            ? [NONPARALLEL_SLICES_WARNING]
            : []),
        ],
      };
    })
    .sort((left, right) =>
      canonicalKey(left.key) < canonicalKey(right.key) ? -1 : 1
    );

  // A series that plans to one instance is a whole volume: nothing was held
  // out of a sibling, and one slice has no order or spacing to get wrong.
  const lone = planned.length === 1 && planned[0].members.length === 1;
  const collections = lone
    ? planned.map((collection) => ({
        ...collection,
        warnings: collection.warnings.filter(
          (warning) => warning !== UNREADABLE_POSITION_WARNING
        ),
      }))
    : planned;

  validateCollections(kept, collections);

  return { collections };
}
