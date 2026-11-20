import { clampValue } from '@/src/utils';

/** Keeps the slab thickness, centring it on the target as far as the source allows. */
export function centerSlabOnSlice(
  range: { first: number; last: number | null; maximum: number },
  slice: number
) {
  const maximum = Math.max(0, Math.floor(range.maximum));
  const target = clampValue(Math.round(slice), 0, maximum);
  const previousFirst = clampValue(Math.round(range.first), 0, maximum);
  const span =
    clampValue(Math.round(range.last ?? maximum), previousFirst, maximum) -
    previousFirst;
  const first = clampValue(target - Math.ceil(span / 2), 0, maximum - span);
  return { first, last: first + span };
}
