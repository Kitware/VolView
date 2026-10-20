import { WL_HIST_BINS } from '@/src/constants';
import {
  histogram,
  histogramWindowRanges,
  scalarRange,
} from '@/src/utils/histogram';

/** Bounded statistics for a scalar image with continuous intensity units. */
export function imageWindowRanges(values: ArrayLike<number>) {
  const range = scalarRange(values);
  if (!range) return null;
  const { min, max } = range;
  const bins = histogram(values, [min, max], WL_HIST_BINS, 0);
  return {
    ...range,
    width: Math.max(1e-12, max - min),
    level: (min + max) / 2,
    ranges: histogramWindowRanges(bins, [min, max], 0),
  };
}
