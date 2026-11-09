/** Keep the rounded midpoint on the target, shrinking only at source edges. */
export function centerSlabOnSlice(
  range: { first: number; last: number | null; maximum: number },
  slice: number
) {
  const maximum = Math.max(0, Math.floor(range.maximum));
  const target = Math.min(maximum, Math.max(0, Math.round(slice)));
  const previousFirst = Math.min(maximum, Math.max(0, Math.round(range.first)));
  const previousLast = Math.min(
    maximum,
    Math.max(previousFirst, Math.round(range.last ?? maximum))
  );
  const span = Math.min(
    previousLast - previousFirst,
    2 * target,
    2 * (maximum - target) + 1
  );
  const first = target - Math.ceil(span / 2);
  return { first, last: first + span };
}
