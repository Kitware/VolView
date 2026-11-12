import { WLAutoRanges } from '@/src/constants';

/** Bins span [min, max + 1), so integer intensities fill whole bins. */
export function histogram(
  data: ArrayLike<number>,
  dataRange: readonly number[],
  numberOfBins: number
) {
  const [min, max] = dataRange;
  const span = max - min + 1;
  const hist = new Array(numberOfBins).fill(0);
  for (let index = 0; index < data.length; index += 1) {
    const value = data[index];
    if (Number.isNaN(value)) continue;
    if (!Number.isFinite(value))
      throw new Error('Image windowing requires finite intensities');
    const bin = Math.min(
      numberOfBins - 1,
      Math.max(0, Math.floor(((value - min) / span) * numberOfBins))
    );
    hist[bin] += 1;
  }
  return hist;
}

/** Exact full range with percentile bounds expanded to their histogram bins. */
export function histogramWindowRanges(
  hist: ArrayLike<number>,
  dataRange: readonly number[]
) {
  const [min, max] = dataRange;
  let validCount = 0;
  for (let index = 0; index < hist.length; index += 1)
    validCount += hist[index];
  const span = max - min + 1;
  const percentileRange = (percentage: number): [number, number] => {
    if (min === max || !validCount) return [min, max];
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

/** Bins and scaling as vtkPiecewiseGaussianWidget draws them: bin i at min + i * span / (bins - 1). */
export function piecewiseHistogram(
  values: ArrayLike<number>,
  [min, max]: readonly number[],
  numberOfBins: number
) {
  const counts = new Float32Array(numberOfBins);
  const span = max - min;
  if (!(span > 0)) return counts;
  for (let index = 0; index < values.length; index += 1) {
    const bin = Math.floor(((numberOfBins - 1) * (values[index] - min)) / span);
    if (bin >= 0 && bin < numberOfBins) counts[bin] += 1;
  }
  const scale = counts.slice().sort()[numberOfBins - 2] || 1;
  return counts.map((count) => count / scale);
}
