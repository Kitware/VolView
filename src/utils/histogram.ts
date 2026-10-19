import { WLAutoRanges } from '@/src/constants';

/** NaN denotes a missing sample. Every occupied sample must be finite. */
export function scalarRange(data: ArrayLike<number>) {
  let min = Infinity;
  let max = -Infinity;
  let validCount = 0;
  for (let index = 0; index < data.length; index += 1) {
    const value = data[index];
    if (Number.isNaN(value)) continue;
    if (!Number.isFinite(value))
      throw new Error('Image windowing requires finite intensities');
    validCount += 1;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return validCount ? { min, max, validCount } : null;
}

/** sampleWidth is 1 for inclusive integer bins and 0 for continuous samples. */
export function histogram(
  data: ArrayLike<number>,
  dataRange: readonly number[],
  numberOfBins: number,
  sampleWidth = 1
) {
  const [min, max] = dataRange;
  const span = max - min + sampleWidth;
  const hist = new Array(numberOfBins).fill(0);
  for (let index = 0; index < data.length; index += 1) {
    const value = data[index];
    if (Number.isNaN(value)) continue;
    if (!Number.isFinite(value))
      throw new Error('Image windowing requires finite intensities');
    const bin = span
      ? Math.min(
          numberOfBins - 1,
          Math.max(0, Math.floor(((value - min) / span) * numberOfBins))
        )
      : 0;
    hist[bin] += 1;
  }
  return hist;
}

/** Exact full range with percentile bounds expanded to their histogram bins. */
export function histogramWindowRanges(
  hist: ArrayLike<number>,
  dataRange: readonly number[],
  sampleWidth = 1
) {
  const [min, max] = dataRange;
  let validCount = 0;
  for (let index = 0; index < hist.length; index += 1)
    validCount += hist[index];
  const span = max - min + sampleWidth;
  const percentileRange = (percentage: number): [number, number] => {
    if (min === max || !percentage || !validCount) return [min, max];
    const lowerRank = Math.max(1, Math.ceil(validCount * percentage * 0.01));
    const upperRank = Math.ceil(validCount * (1 - percentage * 0.01));
    let count = 0;
    let start = 0;
    let end = hist.length - 1;
    let foundStart = false;
    for (let bin = 0; bin < hist.length; bin += 1) {
      count += hist[bin];
      if (!foundStart && count >= lowerRank) {
        start = bin;
        foundStart = true;
      }
      if (count >= upperRank) {
        end = bin;
        break;
      }
    }
    return [
      Math.max(min, min + (span * start) / hist.length),
      Math.min(max, min + (span * (end + 1)) / hist.length),
    ];
  };
  return {
    FullRange: [min, max] as [number, number],
    LowContrast: percentileRange(WLAutoRanges.LowContrast),
    MediumContrast: percentileRange(WLAutoRanges.MediumContrast),
    HighContrast: percentileRange(WLAutoRanges.HighContrast),
  };
}
