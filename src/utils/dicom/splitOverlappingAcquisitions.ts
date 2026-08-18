import { vec3 } from 'gl-matrix';
import { Chunk } from '@/src/core/streaming/chunk';
import { Tags } from '@/src/core/dicomTags';
import {
  getChunkTag,
  getSliceNormal,
  toVec,
} from '@/src/utils/dicom/dicomChunks';

// Tags tried, in order, as the identity of a single scan. A tag that does not
// split hands the volume to the next tag; a tag that does split recurses into
// each part with the remaining tags, so a 4D multi-echo series separates on
// both axes. Every entry traces to an IDC series in
// __tests__/idcSeriesFixtures.ts. StackID (0020|9056) is absent on purpose:
// bilateral slab series put two stacks in one sound volume.
const SPLIT_TAGS = [
  { tag: Tags.AcquisitionNumber, label: 'acquisition' },
  { tag: Tags.TemporalPositionIdentifier, label: 'phase' },
  { tag: Tags.EchoNumbers, label: 'echo' },
];

/**
 * Distance of each chunk along the normal of the first slice.
 *
 * Computed once per volume and threaded through the split, since every later
 * question (does this group overlap, does this part repeat a position) is
 * answered from the same numbers. Returns null when orientation or position
 * is missing, since nothing can be judged about a volume whose geometry
 * cannot be read.
 */
function getSlicePositions(chunks: Chunk[]) {
  const orientation = toVec(
    getChunkTag(chunks[0], Tags.ImageOrientationPatient)
  );
  if (orientation?.length !== 6) return null;

  const normal = getSliceNormal(orientation);

  const positions = new Map<Chunk, number>();
  for (let i = 0; i < chunks.length; i += 1) {
    const position = toVec(getChunkTag(chunks[i], Tags.ImagePositionPatient));
    if (position?.length !== 3) return null;
    positions.set(chunks[i], vec3.dot(normal, position as vec3));
  }
  return positions;
}

type Positions = Map<Chunk, number>;

/** Two slices at one position cannot both belong to the same volume. */
function hasDuplicatePositions(chunks: Chunk[], positions: Positions) {
  const seen = new Set(chunks.map((chunk) => positions.get(chunk)));
  return seen.size !== chunks.length;
}

export function hasDuplicateSlicePositions(chunks: Chunk[]) {
  const positions = getSlicePositions(chunks);
  return positions ? hasDuplicatePositions(chunks, positions) : false;
}

function groupByTag(chunks: Chunk[], tag: string) {
  const groups = new Map<string, Chunk[]>();
  for (let i = 0; i < chunks.length; i += 1) {
    const value = getChunkTag(chunks[i], tag)?.trim();
    if (!value) return null;
    const group = groups.get(value);
    if (group) group.push(chunks[i]);
    else groups.set(value, [chunks[i]]);
  }
  return groups;
}

/**
 * Whether any two groups cover overlapping stretches of the slice axis.
 *
 * Sorting by lower bound and sweeping keeps this linear in the number of
 * groups, which is unbounded: scanners that set AcquisitionNumber from
 * InstanceNumber yield one group per slice.
 *
 * Bounds are closed, so scans that merely share a boundary slice count as
 * overlapping: that shared position is a duplicate either way.
 */
function anySpansOverlap(spans: { min: number; max: number }[]) {
  const sorted = [...spans].sort((a, b) => a.min - b.min);
  let reach = -Infinity;
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i].min <= reach) return true;
    reach = Math.max(reach, sorted[i].max);
  }
  return false;
}

function getSpan(chunks: Chunk[], positions: Positions) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < chunks.length; i += 1) {
    const position = positions.get(chunks[i])!;
    if (position < min) min = position;
    if (position > max) max = position;
  }
  return { min, max };
}

/**
 * Groups of slices that cover overlapping stretches of the slice axis.
 *
 * Scans that follow one another along the axis are one volume between them and
 * are left merged, however their acquisition is numbered. Scans that cover the
 * same stretch twice are not, whatever their spacing works out to.
 */
function findOverlappingGroups(
  chunks: Chunk[],
  tag: string,
  positions: Positions
) {
  const groups = groupByTag(chunks, tag);
  if (!groups || groups.size < 2) return null;

  const entries = [...groups.entries()].map(([value, group]) => ({
    value,
    chunks: group,
  }));
  const spans = entries.map((entry) => getSpan(entry.chunks, positions));
  return anySpansOverlap(spans) ? entries : null;
}

// Mirrors the volume ID suffixing done by the itk-wasm categorize pipeline:
// keep the part alphanumeric so IDs stay roughly UID shaped.
const encodeIdPart = (value: string) => value.replace(/[^A-Za-z0-9]/g, 'D');

type SplitPart = { suffixes: string[]; labels: string[]; chunks: Chunk[] };

/**
 * Separates chunks on the first of `tags` that yields overlapping groups, then
 * re-examines each part with the remaining tags. Returns null when no tag
 * splits.
 */
function splitByTags(
  chunks: Chunk[],
  positions: Positions,
  tags: typeof SPLIT_TAGS = SPLIT_TAGS
): SplitPart[] | null {
  const [head, ...rest] = tags;
  if (!head) return null;

  const groups = findOverlappingGroups(chunks, head.tag, positions);
  if (!groups) return splitByTags(chunks, positions, rest);

  return groups.flatMap(({ value, chunks: group }) => {
    const suffix = encodeIdPart(value);
    const partLabel = `${head.label} ${value}`;
    const nested = splitByTags(group, positions, rest);
    if (!nested) {
      return [{ suffixes: [suffix], labels: [partLabel], chunks: group }];
    }
    return nested.map((child) => ({
      suffixes: [suffix, ...child.suffixes],
      labels: [partLabel, ...child.labels],
      chunks: child.chunks,
    }));
  });
}

/**
 * Separates volumes that hold more than one scan of the same anatomy.
 *
 * A single DICOM series can carry several scans of one Z range: overlapping
 * acquisitions, DCE timepoints, or Dixon echoes. The itk-wasm categorize
 * pipeline keeps them together because its grouping key covers none of those
 * tags, and merging them interleaves slices from different passes and derives
 * a Z spacing from a lattice none of them sit on.
 *
 * The test is whether per-tag-value groups cover overlapping stretches of the
 * slice axis, decided by comparing positions rather than by measuring how even
 * the spacing looks. Series whose groups follow one another along the axis are
 * passed through and keep their chunk array identity.
 *
 * Each split volume's ID appends one encoded tag value per splitting level,
 * with a display name for the split ('acquisition 2', 'phase 3, echo 1') in
 * `labels`. Volumes still holding two slices at one position are listed in
 * `duplicated`. When two distinct tag values encode to one ID, splitting would
 * silently drop chunks, so the volume is passed through unsplit and listed in
 * `collided`.
 *
 * Deliberately conservative in two places: one overlapping pair separates
 * every group at that level, including groups that sequentially continue one
 * another, and series interleaved along a dimension no listed tag captures
 * (private-tag b-values, repeat breath-holds separated only by
 * AcquisitionTime) stay merged and are only reported through `duplicated`.
 */
export function splitOverlappingAcquisitions(
  chunksByVolume: Record<string, Chunk[]>
) {
  const duplicated: string[] = [];
  const collided: string[] = [];
  const labels: Record<string, string> = {};

  const entries = Object.entries(chunksByVolume).flatMap(
    ([volumeId, chunks]) => {
      // Unreadable geometry: nothing can be judged, so pass the volume
      // through as the pipeline grouped it.
      const positions = getSlicePositions(chunks);
      if (!positions) return [[volumeId, chunks] as const];

      const split = splitByTags(chunks, positions);
      if (split) {
        const ids = split.map(
          ({ suffixes }) => `${volumeId}.${suffixes.join('.')}`
        );
        if (new Set(ids).size === ids.length) {
          return split.map((part, i) => {
            labels[ids[i]] = part.labels.join(', ');
            if (hasDuplicatePositions(part.chunks, positions)) {
              duplicated.push(ids[i]);
            }
            return [ids[i], part.chunks] as const;
          });
        }
        collided.push(volumeId);
      }

      if (hasDuplicatePositions(chunks, positions)) duplicated.push(volumeId);
      return [[volumeId, chunks] as const];
    }
  );

  return {
    volumes: Object.fromEntries(entries),
    duplicated,
    collided,
    labels,
  };
}
