const close = (a: number, b: number) =>
  Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-5;
export const sameVector = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a.length === b.length && Array.from(a).every((n, i) => close(n, b[i]));
const dot = (a: readonly number[], b: readonly number[]) =>
  a.reduce((sum, n, i) => sum + n * b[i], 0);

export function octDirection(basis: number[] | null | undefined) {
  if (!basis || basis.length !== 6 || !basis.every(Number.isFinite))
    return null;
  const row = basis.slice(0, 3);
  const column = basis.slice(3);
  if (
    !close(Math.hypot(...row), 1) ||
    !close(Math.hypot(...column), 1) ||
    !close(dot(row, column), 0)
  )
    return null;
  return [
    ...basis,
    row[1] * column[2] - row[2] * column[1],
    row[2] * column[0] - row[0] * column[2],
    row[0] * column[1] - row[1] * column[0],
  ];
}

/** Validate equally spaced slices along the positive image normal. */
export function octGridGeometry(positions: number[][], direction?: number[]) {
  if (positions.some((p) => p.length !== 3 || !p.every(Number.isFinite)))
    return {
      reason:
        'DICOM slice positions are invalid; spatial reconstruction is required.',
    };
  if (positions.length < 2) return { reason: null };
  const step = positions
    .at(-1)!
    .map((n, axis) => (n - positions[0][axis]) / (positions.length - 1));
  const distance = Math.hypot(...step);
  if (distance <= 1e-5)
    return {
      reason: 'Repeated DICOM slice locations need spatial reconstruction.',
    };
  if (
    direction &&
    !sameVector(
      step,
      direction.slice(6).map((n) => n * distance)
    )
  )
    return {
      reason:
        'DICOM slice positions do not follow the image grid; spatial reconstruction is required.',
    };
  if (
    positions.some(
      (position, i) =>
        !sameVector(
          position,
          positions[0].map((n, axis) => n + i * step[axis])
        )
    )
  )
    return {
      reason:
        'DICOM slices have nonuniform positions; spatial reconstruction is required.',
    };
  return { reason: null, distance };
}
