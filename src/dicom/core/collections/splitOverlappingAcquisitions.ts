import type { InstanceFacts } from './planDicomCollections';
import { groupBy } from './groupBy';

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
const SEMANTIC_AXES = [
  { rule: 'acquisition', fact: 'acquisitionNumber', kind: 'counter' },
  { rule: 'phase', fact: 'temporalPositionIdentifier', kind: 'counter' },
  { rule: 'echo', fact: 'echoNumbers', kind: 'contrast' },
  { rule: 'b-value', fact: 'diffusionBValue', kind: 'contrast' },
  { rule: 'sequence', fact: 'sequenceName', kind: 'descriptor' },
  { rule: 'thickness', fact: 'sliceThickness', kind: 'descriptor' },
  { rule: 'series', fact: 'seriesNumber', kind: 'descriptor' },
  { rule: 'date', fact: 'seriesDate', kind: 'descriptor' },
] as const;

type SemanticAxis = (typeof SEMANTIC_AXES)[number];

type SemanticPart = {
  // One entry per axis, in SEMANTIC_AXES order: the value the part was split
  // out on, or null where the axis did not partition its members.
  parts: Array<[string, string | null]>;
  members: InstanceFacts[];
  // 'acquisition 2, echo 1'; null for members nothing separated.
  label: string | null;
  // Two members share a slice position and no axis separates them.
  repeatedPositions: boolean;
  // No member of this part carries a readable slice position, so nothing
  // spatial was judged about it.
  unreadablePositions: boolean;
};

// The key part that keeps the members of unreadable geometry apart from the
// judged parts of the same series.
const GEOMETRY_RULE = 'geometry';
const UNREADABLE_GEOMETRY = 'unreadable';

/**
 * Where a member sits along the slice axis: the planner passes the projection
 * on its bucket's common normal.
 */
export type PositionOf = (member: InstanceFacts) => number | null;

const spanOf = (group: InstanceFacts[], positionOf: PositionOf) => {
  const positions = group.map(positionOf) as number[];
  return { min: Math.min(...positions), max: Math.max(...positions) };
};

/**
 * Whether any two groups cover overlapping stretches of the slice axis.
 * Bounds are closed, so scans sharing a boundary slice count as overlapping:
 * that shared position is a duplicate either way.
 */
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
  const independentImages = singlePlane && axis.kind === 'descriptor';
  const tagged = groupBy(
    members.filter((member) => member[axis.fact] !== null || independentImages),
    (member) => member[axis.fact]
  );
  // A counter stamped per slice cannot establish a separate acquisition.
  // Descriptor differences on one plane distinguish images without removing
  // a slice from a spatial stack.
  const eligible = new Map(
    [...tagged].filter(
      ([, group]) =>
        axis.kind === 'contrast' || independentImages || group.length > 1
    )
  );
  const remainder = members.filter(
    (member) => !eligible.has(member[axis.fact])
  );
  return { tagged: eligible, remainder };
};

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

const labelFor = (axis: SemanticAxis, members: InstanceFacts[]) => {
  const values = new Set(members.map((member) => member[axis.fact]));
  const value = values.size === 1 ? [...values][0] : 'mixed';
  return `${axis.rule} ${value ?? 'unknown'}`;
};

// Members no axis can judge, held apart by descriptor under a key part of
// their own.
const splitUnreadable = (
  members: InstanceFacts[],
  axes: SemanticAxis[]
): SemanticPart[] => {
  const descriptors = axes.filter((axis) => axis.kind === 'descriptor');
  const groups = [
    ...groupBy(members, (member) =>
      JSON.stringify(descriptors.map((axis) => member[axis.fact]))
    ).values(),
  ];
  const differing = descriptors.filter(
    (axis) => new Set(members.map((member) => member[axis.fact])).size > 1
  );
  return groups.map((group) => ({
    parts: [
      ...axes.map((axis): [string, string | null] => [
        axis.rule,
        axis.kind === 'descriptor' ? group[0][axis.fact] : null,
      ]),
      [GEOMETRY_RULE, UNREADABLE_GEOMETRY],
    ],
    members: group,
    label: differing.map((axis) => labelFor(axis, group)).join(', ') || null,
    repeatedPositions: false,
    unreadablePositions: true,
  }));
};

function splitByAxes(
  members: InstanceFacts[],
  axes: SemanticAxis[],
  positionOf: PositionOf
): SemanticPart[] {
  // Counters alone leave a repeatedly scanned plane as a time series. Contrast
  // tags and descriptors can still distinguish independent images on it.
  const distinctPositions = new Set(members.map(positionOf)).size;
  const singlePlane = distinctPositions === 1;
  const found = firstSplittingAxis(
    members,
    singlePlane ? axes.filter((axis) => axis.kind !== 'counter') : axes,
    positionOf,
    singlePlane
  );
  if (!found)
    return unsplit(members, axes, distinctPositions !== members.length);

  const { axis, tagged, remainder } = found;
  const index = axes.indexOf(axis);
  const skipped = axes.slice(0, index);
  const rest = axes.slice(index + 1);
  const splits = [
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
  positionOf: PositionOf
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
