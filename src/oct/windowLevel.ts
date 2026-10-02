import { WLAutoRanges, WL_HIST_BINS } from '@/src/constants';

/** Same normalized viewport sensitivity as vtkMouseRangeManipulator. */
export function windowLevelFromDrag(
  initial: { width: number; level: number },
  range: { min: number; max: number },
  delta: { x: number; y: number },
  viewport: { width: number; height: number }
) {
  if (
    ![
      initial.width,
      initial.level,
      range.min,
      range.max,
      delta.x,
      delta.y,
      viewport.width,
      viewport.height,
    ].every(Number.isFinite) ||
    initial.width <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    range.max < range.min
  )
    throw new Error(
      'Window/level drag requires finite values, positive width and viewport, and an ordered intensity range'
    );
  const span = range.max - range.min || 1;
  const step = Math.min(span, 1) / 256;
  const sensitivity = span / (step + 1);
  const quantized = (change: number) =>
    step * Math.floor(Math.abs(change / step)) * Math.sign(change);
  const level =
    initial.level +
    quantized((delta.x / Math.max(1, viewport.width)) * sensitivity);
  // DOM y points down; VTK display y points up.
  const width =
    initial.width +
    quantized((-delta.y / Math.max(1, viewport.height)) * sensitivity);
  return {
    width: Math.min(span, Math.max(1e-12, width)),
    level: Math.min(range.max, Math.max(range.min, level)),
  };
}

/** Blend the normal segment fill over OCT reflectivity, retaining its texture. */
export function thinRegionColor(
  gray: number,
  color: readonly [number, number, number, number],
  alpha: number
) {
  return [
    Math.round(gray * (1 - alpha) + color[0] * alpha),
    Math.round(gray * (1 - alpha) + color[1] * alpha),
    Math.round(gray * (1 - alpha) + color[2] * alpha),
    255,
  ];
}

/** Map projected intensities to the normal grayscale window before segment fill. */
export function paintProjectionIntensities(
  values: ArrayLike<number>,
  pixels: Uint8ClampedArray,
  window: { width: number; level: number },
  validPixels?: ArrayLike<number>
) {
  const lower = window.level - window.width / 2;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const gray =
      Number.isFinite(value) && (!validPixels || validPixels[index] === 1)
        ? Math.round(
            Math.min(1, Math.max(0, (value - lower) / window.width)) * 255
          )
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
    validPixels?: ArrayLike<number>;
  }
) {
  let count = 0;
  for (let index = 0; index < thickness.length; index += 1) {
    if (
      thickness[index] > 0 &&
      thickness[index] < thresholdMicrons &&
      (!appearance.validPixels || appearance.validPixels[index] === 1)
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
function projectionRange(
  values: ArrayLike<number>,
  validPixels?: ArrayLike<number>
) {
  let validCount = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < values.length; index += 1) {
    if (validPixels && validPixels[index] !== 1) continue;
    validCount += 1;
    const value = values[index];
    if (!Number.isFinite(value))
      throw new Error('Projection windowing requires finite intensities');
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return validCount ? { min, max, validCount } : null;
}

/** Bounded histogram of projected float intensities; Full Range remains exact. */
export function projectionWindowRanges(
  values: ArrayLike<number>,
  validPixels?: ArrayLike<number>
) {
  const range = projectionRange(values, validPixels);
  if (!range) return null;
  const { min, max, validCount } = range;
  const span = max - min;
  const bins = new Uint32Array(WL_HIST_BINS);
  if (span > 0) {
    for (let index = 0; index < values.length; index += 1) {
      if (validPixels && validPixels[index] !== 1) continue;
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
