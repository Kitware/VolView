/**
 * Linearly interpolates x-sorted `[x, ...values]` points at `x`, holding the
 * end values beyond the end points.
 */
export function interpolateAt(points: number[][], x: number) {
  const next = points.findIndex(([px]) => px >= x);
  if (next <= 0) return (next === 0 ? points[0] : points.at(-1)!).slice(1);
  const [x0, ...v0] = points[next - 1];
  const [x1, ...v1] = points[next];
  return v0.map((v, i) => v + ((v1[i] - v) * (x - x0)) / (x1 - x0));
}
