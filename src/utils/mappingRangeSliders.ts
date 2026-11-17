/**
 * Step and bounds for the Shift and Width sliders that edit a mapping range
 * relative to a full range of the given width.
 */
export function mappingRangeSliders(fullWidth: number) {
  const step = Math.min(1, fullWidth / 256);
  // Whole steps either side of zero keep an unshifted range on the slider grid.
  const halfShift = step > 0 ? Math.ceil(fullWidth / 2 / step) * step : 0;
  return {
    step,
    shift: [-halfShift, halfShift] as const,
    width: [step, 2 * fullWidth] as const,
  };
}
