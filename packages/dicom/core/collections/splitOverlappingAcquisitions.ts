import type { InstanceFacts } from './planDicomCollections';
import { groupBy } from './groupBy';

export const DESCRIPTOR_AXES = [
  { rule: 'sequence', fact: 'sequenceName', counter: true },
  { rule: 'thickness', fact: 'sliceThickness', counter: true },
  { rule: 'series', fact: 'seriesNumber', counter: true },
  { rule: 'date', fact: 'seriesDate', counter: true },
] as const;

/**
 * Facts tried, in order, as the identity of one scan within a series. An axis
 * that does not split hands the members to the next; an axis that does split
 * recurses into each part with the remaining axes, so a 4D multi-echo series
 * separates on both. Acquisition descriptors provide a fallback when the
 * specific contrast tags are absent. Stack ID is absent on purpose: bilateral
 * slab series put two stacks in one sound volume.
 *
 * Acquisition and phase counters number passes over time. Scanners sometimes
 * stamp them per slice, so they split only multi-slice groups and preserve a
 * repeated single plane as a time series. Descriptors require multi-slice
 * groups too, except when all images share one plane: separating those cannot
 * remove a slice from a spatial stack.
 */
export const SEMANTIC_AXES = [
  { rule: 'acquisition', fact: 'acquisitionNumber', counter: true },
  { rule: 'phase', fact: 'temporalPositionIdentifier', counter: true },
  { rule: 'echo', fact: 'echoNumbers', counter: false },
  { rule: 'b-value', fact: 'diffusionBValue', counter: false },
  ...DESCRIPTOR_AXES,
] as const;

type SemanticAxis = (typeof SEMANTIC_AXES)[number];

const isDescriptor = (axis: SemanticAxis) =>
  DESCRIPTOR_AXES.some((descriptor) => descriptor.fact === axis.fact);

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

/** Eligible groups in first-seen order, with all other members held apart. */
const groupByAxis = (
  members: InstanceFacts[],
  axis: SemanticAxis,
  singlePlane: boolean
) => {
  const independentImages = singlePlane && isDescriptor(axis);
  const tagged = new Map<string | null, InstanceFacts[]>();
  members.forEach((member) => {
    const value = member[axis.fact];
    if (value === null && !independentImages) return;
    const group = tagged.get(value);
    if (group) group.push(member);
    else tagged.set(value, [member]);
  });
  // A counter stamped per slice cannot establish a separate acquisition.
  // Descriptor differences on one plane distinguish images without removing
  // a slice from a spatial stack.
  const eligible = new Map(
    [...tagged].filter(
      ([, group]) => !axis.counter || independentImages || group.length > 1
    )
  );
  const remainder = members.filter((member) => {
    const value = member[axis.fact];
    return !eligible.has(value);
  });
  return { tagged: eligible, remainder };
};

type Split = { value: string | null; members: InstanceFacts[] };

/**
 * The first axis whose tagged groups cover overlapping stretches of the slice
 * axis, with the members that carry no value for it as their own part. Scans
 * that follow one another along the axis are one volume between them and stay
 * merged, however their acquisition is numbered.
 */
const firstSplittingAxis = (
  members: InstanceFacts[],
  axes: SemanticAxis[],
  positionOf: PositionOf,
  singlePlane: boolean
) =>
  axes
    .map((axis) => ({ axis, ...groupByAxis(members, axis, singlePlane) }))
    .find(({ tagged }) => {
      const groups = [...tagged.values()];
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

const labelFor = (axis: SemanticAxis, members: InstanceFacts[]) => {
  const values = new Set(members.map((member) => member[axis.fact]));
  const value = values.size === 1 ? [...values][0] : 'mixed';
  return `${axis.rule} ${value ?? 'unknown'}`;
};

const splitUnreadable = (members: InstanceFacts[], axes: SemanticAxis[]) => {
  const descriptors = DESCRIPTOR_AXES.filter((axis) => axes.includes(axis));
  const groups = [
    ...groupBy(members, (member) =>
      JSON.stringify(descriptors.map((axis) => member[axis.fact]))
    ).values(),
  ];
  const differing = descriptors.filter(
    (axis) => new Set(members.map((member) => member[axis.fact])).size > 1
  );
  return groups.map((group) => {
    const part = unreadableGeometry(group, axes);
    return {
      ...part,
      parts: part.parts.map(([rule, value]): [string, string | null] => {
        const descriptor = descriptors.find((axis) => axis.rule === rule);
        return [rule, descriptor ? group[0][descriptor.fact] : value];
      }),
      label: [
        ...differing.map((axis) => labelFor(axis, group)),
        part.label,
      ].join(', '),
    };
  });
};

function splitByAxes(
  members: InstanceFacts[],
  axes: SemanticAxis[],
  positionOf: PositionOf
): SemanticPart[] {
  // Counters alone leave a repeatedly scanned plane as a time series. Contrast
  // tags and descriptors can still distinguish independent images on it.
  const singlePlane = countDistinctPositions(members, positionOf) === 1;
  const found = firstSplittingAxis(
    members,
    singlePlane
      ? axes.filter((axis) => !axis.counter || isDescriptor(axis))
      : axes,
    positionOf,
    singlePlane
  );
  if (!found)
    return unsplit(members, axes, hasRepeatedPositions(members, positionOf));

  const { axis, tagged, remainder } = found;
  const index = axes.indexOf(axis);
  const skipped = axes.slice(0, index);
  const rest = axes.slice(index + 1);
  const splits: Split[] = [
    ...[...tagged].map(([value, group]) => ({ value, members: group })),
    ...(remainder.length > 0 ? [{ value: null, members: remainder }] : []),
  ];

  return splits.flatMap(({ value, members: group }) =>
    splitByAxes(group, rest, positionOf).map((child) => ({
      ...child,
      parts: [
        ...skipped.map((s): [string, null] => [s.rule, null]),
        [axis.rule, value],
        ...child.parts,
      ],
      label: [labelFor(axis, child.members), child.label]
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
 * every eligible group at that level. Acquisition and phase counters preserve
 * repeated single planes and require groups of multiple slices. Descriptors
 * retain the group-size guard only where several planes form a spatial stack.
 * Members that lack the level's value and excluded singleton groups form a
 * remainder instead of blocking the split.
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
    ...splitUnreadable(unreadable, axes),
  ];
}
