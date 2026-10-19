import { WLAutoRanges, WL_HIST_BINS } from '@/src/constants';
import { isPresentThicknessBelow } from '@/src/oct/thickness';

/** Map projected intensities to the normal grayscale window before segment fill. */
export function paintProjectionIntensities(
  values: ArrayLike<number>,
  pixels: Uint8ClampedArray,
  window: { width: number; level: number }
) {
  const lower = window.level - window.width / 2;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    // A narrow window's lower bound can round back to its center.
    const normalized =
      value === window.level ? 0.5 : (value - lower) / window.width;
    const gray = Number.isFinite(value)
      ? Math.round(Math.min(1, Math.max(0, normalized)) * 255)
      : 0;
    const offset = index * 4;
    pixels[offset] = gray;
    pixels[offset + 1] = gray;
    pixels[offset + 2] = gray;
    pixels[offset + 3] = 255;
  }
}
/** Color only occupied A-lines strictly below the physical thickness threshold. */
export function paintThinRegionPixels(
  pixels: Uint8ClampedArray,
  thickness: ArrayLike<number>,
  thresholdMicrons: number,
  appearance: {
    color: readonly [number, number, number, number];
    alpha: number;
    values?: ArrayLike<number>;
  }
) {
  let count = 0;
  for (let index = 0; index < thickness.length; index += 1) {
    if (
      isPresentThicknessBelow(thickness[index], thresholdMicrons) &&
      (!appearance.values || Number.isFinite(appearance.values[index]))
    ) {
      const offset = index * 4;
      const gray = pixels[offset] * (1 - appearance.alpha);
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = Math.round(
          gray + appearance.color[channel] * appearance.alpha
        );
      }
      pixels[offset + 3] = 255;
      count += 1;
    }
  }
  return count;
}
function projectionRange(values: ArrayLike<number>) {
  let validCount = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (Number.isNaN(value)) continue;
    validCount += 1;
    if (!Number.isFinite(value))
      throw new Error('Projection windowing requires finite intensities');
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return validCount ? { min, max, validCount } : null;
}

/** Bounded histogram of projected float intensities; Full Range remains exact. */
export function projectionWindowRanges(values: ArrayLike<number>) {
  const range = projectionRange(values);
  if (!range) return null;
  const { min, max, validCount } = range;
  const span = max - min;
  const bins = new Uint32Array(WL_HIST_BINS);
  if (span > 0) {
    for (let index = 0; index < values.length; index += 1) {
      if (Number.isNaN(values[index])) continue;
      const bin = Math.min(
        WL_HIST_BINS - 1,
        Math.floor(((values[index] - min) / span) * WL_HIST_BINS)
      );
      bins[bin] += 1;
    }
  }
  const percentileRange = (percentage: number): [number, number] => {
    if (!span || !percentage) return [min, max];
    const lowerRank = Math.max(1, Math.ceil(validCount * percentage * 0.01));
    const upperRank = Math.ceil(validCount * (1 - percentage * 0.01));
    let count = 0;
    let start = 0;
    let end = WL_HIST_BINS - 1;
    let foundStart = false;
    for (let bin = 0; bin < WL_HIST_BINS; bin += 1) {
      count += bins[bin];
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
      min + (span * start) / WL_HIST_BINS,
      Math.min(max, min + (span * (end + 1)) / WL_HIST_BINS),
    ];
  };
  return {
    min,
    max,
    width: Math.max(1e-12, span),
    level: (min + max) / 2,
    ranges: {
      FullRange: [min, max] as [number, number],
      LowContrast: percentileRange(WLAutoRanges.LowContrast),
      MediumContrast: percentileRange(WLAutoRanges.MediumContrast),
      HighContrast: percentileRange(WLAutoRanges.HighContrast),
    },
  };
}
