/**
 * A projected line, in SVG coordinates.
 */
export type ScreenSegment = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

/**
 * One drawable piece of a segment, uniquely keyed by its source segment.
 */
export type SegmentPiece = {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

// Two screen segments this close to parallel never register a crossing.
const CROSSING_EPSILON = 1e-9;

type Interval = [number, number];

/**
 * The position along `segment`, as a fraction of its length, where `other`
 * crosses it — or null when they do not cross within both segments.
 */
function crossingParameter(
  segment: ScreenSegment,
  other: ScreenSegment
): number | null {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const otherDx = other.x2 - other.x1;
  const otherDy = other.y2 - other.y1;

  const denominator = dx * otherDy - dy * otherDx;
  if (Math.abs(denominator) < CROSSING_EPSILON) return null;

  const offsetX = other.x1 - segment.x1;
  const offsetY = other.y1 - segment.y1;
  const t = (offsetX * otherDy - offsetY * otherDx) / denominator;
  const u = (offsetX * dy - offsetY * dx) / denominator;

  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return t;
}

/** Merges overlapping or touching intervals, in ascending order. */
function mergeIntervals(intervals: Interval[]): Interval[] {
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: Interval[] = [];
  intervals.forEach((interval) => {
    const last = merged[merged.length - 1];
    if (last && interval[0] <= last[1]) {
      last[1] = Math.max(last[1], interval[1]);
    } else {
      merged.push([interval[0], interval[1]]);
    }
  });
  return merged;
}

/**
 * Splits projected lines so each one breaks around every point where another
 * line crosses it, leaving `gap` pixels of clear space centred on the crossing.
 *
 * With more than two lines in a view a segment simply gets one gap per
 * crossing; gaps that would overlap merge into one.
 */
export function splitSegmentsAtCrossings(
  segments: ScreenSegment[],
  gap: number
): SegmentPiece[] {
  return segments.flatMap((segment, index) => {
    const dx = segment.x2 - segment.x1;
    const dy = segment.y2 - segment.y1;
    const length = Math.hypot(dx, dy);
    if (length === 0) return [];

    const halfGap = gap / 2 / length;
    const gaps = mergeIntervals(
      segments.flatMap((other, otherIndex) => {
        if (otherIndex === index) return [];
        const t = crossingParameter(segment, other);
        return t === null
          ? []
          : ([[t - halfGap, t + halfGap]] satisfies Interval[]);
      })
    );

    const pieces: SegmentPiece[] = [];
    const emit = (from: number, to: number) => {
      if (to - from <= 0) return;
      pieces.push({
        key: `${segment.id}:${pieces.length}`,
        x1: segment.x1 + dx * from,
        y1: segment.y1 + dy * from,
        x2: segment.x1 + dx * to,
        y2: segment.y1 + dy * to,
      });
    };

    const end = gaps.reduce((cursor, [gapStart, gapEnd]) => {
      emit(cursor, Math.min(gapStart, 1));
      return Math.max(cursor, gapEnd);
    }, 0);
    emit(end, 1);

    return pieces;
  });
}
