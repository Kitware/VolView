import type { InstanceFacts } from '@/src/core/dicom/planDicomCollections';

/**
 * Facts tried, in order, as the identity of one scan within a series. An axis
 * that does not split hands the members to the next; an axis that does split
 * recurses into each part with the remaining axes, so a 4D multi-echo series
 * separates on both. Every entry traces to an IDC series in
 * __tests__/idcSeriesFixtures.ts. Stack ID is absent on purpose: bilateral
 * slab series put two stacks in one sound volume.
 *
 * A counter axis numbers passes over time. Scanners sometimes stamp it per
 * slice, and a repeated plane under it is a time series, so it earns two
 * guards a contrast axis (echo, b-value) does not: it never fans out a single
 * plane, and it splits only on groups that hold more than one slice.
 */
export const SEMANTIC_AXES = [
  { rule: 'acquisition', fact: 'acquisitionNumber', counter: true },
  { rule: 'phase', fact: 'temporalPositionIdentifier', counter: true },
  { rule: 'echo', fact: 'echoNumbers', counter: false },
  { rule: 'b-value', fact: 'diffusionBValue', counter: false },
] as const;

type SemanticAxis = (typeof SEMANTIC_AXES)[number];

export type SemanticPart = {
  // One entry per axis, in SEMANTIC_AXES order: the value the part was split
  // out on, or null where the axis did not partition its members.
  parts: Array<[string, string | null]>;
  members: InstanceFacts[];
  // 'acquisition 2, echo 1'; null for members no axis separated.
  label: string | null;
  // Two members share a slice position and no axis separates them.
  repeatedPositions: boolean;
  // No member of this part carries a readable slice position, so nothing
  // spatial was judged about it.
  unreadablePositions: boolean;
};

// The key part that keeps the members of unreadable geometry apart from the
// judged parts of the same series.
export const GEOMETRY_RULE = 'geometry';
export const UNREADABLE_GEOMETRY = 'unreadable';
export const UNREADABLE_GEOMETRY_LABEL = 'position unknown';

/**
 * Where a member sits along the slice axis. The planner passes the projection
 * on its bucket's common normal; the member's own is the default.
 */
export type PositionOf = (member: InstanceFacts) => number | null;

const ownPosition: PositionOf = (member) => member.projectedPosition;

const countDistinctPositions = (
  members: InstanceFacts[],
  positionOf: PositionOf
) => new Set(members.map(positionOf)).size;

const hasRepeatedPositions = (
  members: InstanceFacts[],
  positionOf: PositionOf
) => countDistinctPositions(members, positionOf) !== members.length;

/**
 * Whether any two groups cover overlapping stretches of the slice axis.
 * Bounds are closed, so scans sharing a boundary slice count as overlapping:
 * that shared position is a duplicate either way.
 */
const spanOf = (group: InstanceFacts[], positionOf: PositionOf) =>
  group.reduce(
    (span, member) => ({
      min: Math.min(span.min, positionOf(member) as number),
      max: Math.max(span.max, positionOf(member) as number),
    }),
    { min: Infinity, max: -Infinity }
  );

const anySpansOverlap = (groups: InstanceFacts[][], positionOf: PositionOf) => {
  const spans = groups
    .map((group) => spanOf(group, positionOf))
    .sort((a, b) => a.min - b.min);
  let reach = -Infinity;
  return spans.some((span) => {
    if (span.min <= reach) return true;
    reach = Math.max(reach, span.max);
    return false;
  });
};

/** Members grouped by the axis value, in first-seen order; untagged apart. */
const groupByAxis = (members: InstanceFacts[], axis: SemanticAxis) => {
  const tagged = new Map<string, InstanceFacts[]>();
  const untagged: InstanceFacts[] = [];
  members.forEach((member) => {
    const value = member[axis.fact];
    if (value === null) {
      untagged.push(member);
      return;
    }
    tagged.set(value, [...(tagged.get(value) ?? []), member]);
  });
  return { tagged, untagged };
};

type Split = { value: string | null; members: InstanceFacts[] };

// A counter stamped per slice yields one group per slice; a single repeated
// position among them must not become one dataset per slice.
const splittingGroups = (axis: SemanticAxis, tagged: InstanceFacts[][]) =>
  axis.counter ? tagged.filter((group) => group.length > 1) : tagged;

/**
 * The first axis whose tagged groups cover overlapping stretches of the slice
 * axis, with the members that carry no value for it as their own part. Scans
 * that follow one another along the axis are one volume between them and stay
 * merged, however their acquisition is numbered.
 */
const firstSplittingAxis = (
  members: InstanceFacts[],
  axes: SemanticAxis[],
  positionOf: PositionOf
) =>
  axes
    .map((axis) => ({ axis, ...groupByAxis(members, axis) }))
    .find(({ axis, tagged }) => {
      const groups = splittingGroups(axis, [...tagged.values()]);
      return groups.length >= 2 && anySpansOverlap(groups, positionOf);
    });

const unsplit = (
  members: InstanceFacts[],
  axes: SemanticAxis[],
  repeatedPositions: boolean
): SemanticPart[] => [
  {
    parts: axes.map((axis) => [axis.rule, null]),
    members,
    label: null,
    repeatedPositions,
    unreadablePositions: false,
  },
];

/** Members no axis can judge, held apart under a key part of their own. */
const unreadableGeometry = (
  members: InstanceFacts[],
  axes: SemanticAxis[]
): SemanticPart => ({
  parts: [
    ...axes.map((axis): [string, null] => [axis.rule, null]),
    [GEOMETRY_RULE, UNREADABLE_GEOMETRY],
  ],
  members,
  label: UNREADABLE_GEOMETRY_LABEL,
  repeatedPositions: false,
  unreadablePositions: true,
});

const labelFor = (axis: SemanticAxis, value: string | null) =>
  value === null ? `${axis.rule} unknown` : `${axis.rule} ${value}`;

function splitByAxes(
  members: InstanceFacts[],
  axes: SemanticAxis[],
  positionOf: PositionOf
): SemanticPart[] {
  // One plane scanned repeatedly is a time series, not a stack of volumes;
  // only a contrast axis may still tell its frames apart.
  const singlePlane = countDistinctPositions(members, positionOf) === 1;
  const found = firstSplittingAxis(
    members,
    singlePlane ? axes.filter((axis) => !axis.counter) : axes,
    positionOf
  );
  if (!found)
    return unsplit(members, axes, hasRepeatedPositions(members, positionOf));

  const { axis, tagged, untagged } = found;
  const index = axes.indexOf(axis);
  const skipped = axes.slice(0, index);
  const rest = axes.slice(index + 1);
  const splits: Split[] = [
    ...[...tagged].map(([value, group]) => ({ value, members: group })),
    ...(untagged.length > 0 ? [{ value: null, members: untagged }] : []),
  ];

  return splits.flatMap(({ value, members: group }) =>
    splitByAxes(group, rest, positionOf).map((child) => ({
      ...child,
      parts: [
        ...skipped.map((s): [string, null] => [s.rule, null]),
        [axis.rule, value],
        ...child.parts,
      ],
      label: [labelFor(axis, value), child.label]
        .filter((part) => part !== null)
        .join(', '),
    }))
  );
}

/**
 * Separates members that hold more than one scan of the same anatomy.
 *
 * A single series can carry several scans of one range: overlapping
 * acquisitions, DCE timepoints, Dixon echoes, or diffusion b-values. Merged,
 * they interleave slices from different passes and derive a slice spacing from
 * a lattice none of them sit on. The test is whether per-value groups cover
 * overlapping stretches of the slice axis, decided by comparing positions
 * rather than by measuring how even the spacing looks.
 *
 * Members whose position cannot be read are judged by nothing here, so they
 * are held in a part of their own instead of suppressing the split of the
 * members that can be judged.
 *
 * Conservative on the members it does judge: one overlapping pair separates
 * every group at that level, and a counter axis neither fans out a repeated
 * single plane nor splits on groups of one slice. Members that lack the value
 * the level splits on form their own part rather than blocking the split, so
 * the result depends only on the members given.
 */
export function splitOverlappingAcquisitions(
  members: InstanceFacts[],
  positionOf: PositionOf = ownPosition
): SemanticPart[] {
  const axes = [...SEMANTIC_AXES];
  const readable = (member: InstanceFacts) =>
    Number.isFinite(positionOf(member));
  const judgeable = members.filter(readable);
  const unreadable = members.filter((member) => !readable(member));

  return [
    ...(judgeable.length > 0 ? splitByAxes(judgeable, axes, positionOf) : []),
    ...(unreadable.length > 0 ? [unreadableGeometry(unreadable, axes)] : []),
  ];
}
