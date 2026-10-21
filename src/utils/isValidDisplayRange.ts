export const isValidDisplayRange = (
  range: readonly [number, number] | undefined
): range is readonly [number, number] =>
  !!range &&
  range.every(Number.isFinite) &&
  range[0] < range[1] &&
  Number.isFinite(range[1] - range[0]);
