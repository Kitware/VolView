import { vec3 } from 'gl-matrix';

export const numbersMatch = (a: number, b: number, tolerance = 1e-5) =>
  Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
export const coordinatesMatch = (
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  tolerance = 1e-5
) =>
  a.length === b.length &&
  Array.from(a).every((n, i) => numbersMatch(n, b[i], tolerance));
export function imageDirection(basis: number[] | null | undefined) {
  if (!basis || basis.length !== 6 || !basis.every(Number.isFinite))
    return null;
  const row = basis.slice(0, 3) as vec3;
  const column = basis.slice(3) as vec3;
  if (
    !numbersMatch(vec3.length(row), 1, 1e-4) ||
    !numbersMatch(vec3.length(column), 1, 1e-4) ||
    !numbersMatch(vec3.dot(row, column), 0, 1e-4)
  )
    return null;
  return [...basis, ...vec3.cross([0, 0, 0], row, column)];
}

/** Validate equally spaced slices along the positive image normal. */
export function frameGridGeometry(positions: number[][], direction?: number[]) {
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
  // Patient positions may be printed to four decimal places in millimetres.
  const tolerance = Math.max(1e-4, distance * 1e-3);
  if (distance <= 1e-5)
    return {
      reason: 'Repeated DICOM slice locations need spatial reconstruction.',
    };
  if (
    direction &&
    !coordinatesMatch(
      step,
      direction.slice(6).map((n) => n * distance),
      tolerance
    )
  )
    return {
      reason:
        'DICOM slice positions do not follow the image grid; spatial reconstruction is required.',
    };
  if (
    positions.some(
      (position, i) =>
        !coordinatesMatch(
          position,
          positions[0].map((n, axis) => n + i * step[axis]),
          tolerance
        )
    )
  )
    return {
      reason:
        'DICOM slices have nonuniform positions; spatial reconstruction is required.',
    };
  return { reason: null, distance };
}
