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

/** Amber overlay keeps the underlying OCT reflectivity texture visible. */
export function thinRegionColor(gray: number) {
  const alpha = 0.35;
  return [
    Math.round(gray * (1 - alpha) + 255 * alpha),
    Math.round(gray * (1 - alpha) + 140 * alpha),
    Math.round(gray * (1 - alpha)),
    255,
  ];
}

/** Bounded histogram of projected float intensities; Full Range remains exact. */
export function projectionWindowRanges(values: ArrayLike<number>) {
  if (!values.length) return null;
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value))
      throw new Error('Projection windowing requires finite intensities');
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const span = max - min;
  const bins = new Uint32Array(WL_HIST_BINS);
  if (span > 0) {
    for (let index = 0; index < values.length; index += 1) {
      const bin = Math.min(
        WL_HIST_BINS - 1,
        Math.floor(((values[index] - min) / span) * WL_HIST_BINS)
      );
      bins[bin] += 1;
    }
  }
  const percentileRange = (percentage: number): [number, number] => {
    if (!span || !percentage) return [min, max];
    const lowerRank = Math.max(1, Math.ceil(values.length * percentage * 0.01));
    const upperRank = Math.ceil(values.length * (1 - percentage * 0.01));
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
