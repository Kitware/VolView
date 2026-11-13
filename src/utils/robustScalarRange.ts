const SAMPLE_BUDGET = 2 ** 17;
const TAIL_PERCENT = 1;

function sampleValues(values: ArrayLike<number>) {
  const count = Math.min(values.length, SAMPLE_BUDGET);
  return Float64Array.from({ length: count }, (_, index) => {
    // Jittered strata keep an integer stride from aliasing with the voxel grid.
    let hash = Math.imul(index + 1, 0x9e3779b1);
    hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
    const offset = ((hash ^ (hash >>> 13)) >>> 0) / 0x100000000;
    return values[Math.floor(((index + offset) * values.length) / count)];
  });
}

/** The finite values of a deterministic sample, sorted ascending. */
export const sortedSample = (values: ArrayLike<number>) =>
  sampleValues(values).filter(Number.isFinite).sort();

/**
 * Percentile bounds of the sampled intensities above the minimum, which is
 * treated as background. Falls back to `range` when no sample is above it.
 */
export function robustRangeOfSorted(
  sorted: Float64Array,
  range: readonly [number, number]
): [number, number] {
  const start = sorted.findIndex((value) => value > sorted[0]);
  if (start < 0) return [range[0], range[1]];
  const foreground = sorted.subarray(start);
  const tail = (TAIL_PERCENT / 100) * (foreground.length - 1);
  const low = foreground[Math.floor(tail)];
  const high = foreground[Math.ceil(foreground.length - 1 - tail)];
  // A single foreground level, as in a binary mask, ramps up from background.
  return low < high ? [low, high] : [sorted[0], high];
}

export const robustScalarRange = (
  values: ArrayLike<number>,
  range: readonly [number, number]
) => robustRangeOfSorted(sortedSample(values), range);
