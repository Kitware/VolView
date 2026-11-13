// The largest power of two dividing the offset; offset zero outranks all.
const coarseness = (offset: number) =>
  offset === 0 ? Infinity : offset & -offset;

const precedes = (left: number, right: number, focus: number) => {
  const leftOffset = Math.abs(left - focus);
  const rightOffset = Math.abs(right - focus);
  const byCoarseness = coarseness(rightOffset) - coarseness(leftOffset);
  if (byCoarseness !== 0 && !Number.isNaN(byCoarseness))
    return byCoarseness < 0;
  if (leftOffset !== rightOffset) return leftOffset < rightOffset;
  return left < right;
};

/**
 * The slot to load next: the focus first, then outward at halving strides,
 * so a partly loaded volume samples its whole extent evenly. Ties go to the
 * nearer slot, then the lower one. Undefined when nothing is pending.
 */
export function pickNextSlot(pending: Iterable<number>, focus: number) {
  const center = Number.isFinite(focus) ? Math.round(focus) : 0;
  let best: number | undefined;
  for (const slot of pending) {
    if (best === undefined || precedes(slot, best, center)) best = slot;
  }
  return best;
}
