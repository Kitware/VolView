import { Tags } from '@/src/core/dicomTags';
import {
  isOCTMetadata,
  octCalibratedAxes,
  octGeometryReason,
} from '@/src/oct/detection';

const close = (a: number, b: number) =>
  Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-5;
export const sameVector = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a.length === b.length && Array.from(a).every((n, i) => close(n, b[i]));
const dot = (a: readonly number[], b: readonly number[]) =>
  a.reduce((sum, n, i) => sum + n * b[i], 0);

type Grid = {
  spacing: ArrayLike<number>;
  direction: ArrayLike<number>;
  origin: ArrayLike<number>;
};

function vector(tags: Map<string, string>, tag: string, length: number) {
  const result = tags.get(tag)?.split('\\').map(Number);
  return result?.length === length && result.every(Number.isFinite)
    ? result
    : null;
}

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

/** Validate equally spaced B-scans along the positive image normal. */
export function octGridGeometry(positions: number[][], direction?: number[]) {
  if (positions.some((p) => p.length !== 3 || !p.every(Number.isFinite)))
    return {
      reason:
        'OCT B-scan positions are invalid; spatial reconstruction is required.',
    };
  if (positions.length < 2) return { reason: null };
  const step = positions[1].map((n, axis) => n - positions[0][axis]);
  const distance = Math.hypot(...step);
  if (distance <= 1e-5)
    return {
      reason: 'Repeated OCT B-scan locations need spatial reconstruction.',
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
        'OCT B-scan positions do not follow the image grid; spatial reconstruction is required.',
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
        'OCT B-scans have nonuniform positions; spatial reconstruction is required.',
    };
  return { reason: null, distance };
}

function declaredSeriesReason(tags: Map<string, string>[]) {
  const reason = tags.map(octGeometryReason).find((value) => value !== null);
  if (reason) return reason;
  const sop = tags[0].get(Tags.SOPClassUID)?.trim();
  if (
    tags.some(
      (entry) =>
        !isOCTMetadata(entry) || entry.get(Tags.SOPClassUID)?.trim() !== sop
    )
  )
    return 'The OCT files have incompatible image types; spatial reconstruction is required.';
  const spacing = vector(tags[0], Tags.PixelSpacing, 2);
  if (
    tags.some((entry) => {
      const other = vector(entry, Tags.PixelSpacing, 2);
      return spacing && other ? !sameVector(spacing, other) : spacing !== other;
    })
  )
    return 'The OCT files have inconsistent pixel spacing; spatial reconstruction is required.';
  return null;
}

function seriesPositions(tags: Map<string, string>[]) {
  const positions = tags.map((entry) =>
    vector(entry, Tags.ImagePositionPatient, 3)
  );
  return positions.every((position) => position !== null) ? positions : null;
}

function sliceSpacingReason(tags: Map<string, string>[], distance: number) {
  if (
    tags.some((entry) => {
      const declared = Number(entry.get(Tags.SpacingBetweenSlices));
      return (
        Number.isFinite(declared) && declared > 0 && !close(declared, distance)
      );
    })
  )
    return 'The OCT slice spacing disagrees with its file positions; spatial reconstruction is required.';
  return null;
}

function loadedGridReason(
  grid: Grid | undefined,
  direction: number[],
  origin: number[],
  distance: number
) {
  if (
    grid &&
    (!sameVector(grid.direction, direction) ||
      !sameVector(grid.origin, origin) ||
      !close(grid.spacing[2], distance))
  )
    return 'The loaded OCT grid does not match its file geometry; spatial reconstruction is required.';
  return null;
}

function seriesGeometry(tags: Map<string, string>[], grid?: Grid) {
  const declaredReason = declaredSeriesReason(tags);
  if (declaredReason) return { reason: declaredReason };
  const direction = octDirection(
    vector(tags[0], Tags.ImageOrientationPatient, 6)
  );
  if (
    !direction ||
    tags.some((entry) => {
      const other = octDirection(
        vector(entry, Tags.ImageOrientationPatient, 6)
      );
      return !other || !sameVector(direction, other);
    })
  )
    return {
      reason:
        'The OCT files have missing or inconsistent image orientation; spatial reconstruction is required.',
    };
  const positions = seriesPositions(tags);
  if (!positions)
    return {
      reason:
        'The OCT files have incomplete or invalid B-scan positions; spatial reconstruction is required.',
    };
  const geometry = octGridGeometry(positions, direction);
  if (geometry.reason) return geometry;
  const distance = geometry.distance!;
  const reason =
    sliceSpacingReason(tags, distance) ||
    loadedGridReason(grid, direction, positions[0], distance);
  return { reason, distance };
}

/** Validate the complete assembled OCT series before treating it as a voxel grid. */
export function octSeriesGeometry(
  metadata: readonly Iterable<[string, string]>[],
  grid?: Grid
) {
  const tags = metadata.map((entry) => new Map(entry));
  if (!tags.length)
    return { reason: null, calibratedAxes: [false, false, false] };
  const series =
    tags.length > 1
      ? seriesGeometry(tags, grid)
      : { reason: octGeometryReason(tags[0]), distance: undefined };
  const pixelSpacing = tags[0].get(Tags.PixelSpacing)?.split('\\').map(Number);
  const declared = [
    pixelSpacing?.[1],
    pixelSpacing?.[0],
    series.distance ?? Number(tags[0].get(Tags.SpacingBetweenSlices)),
  ];
  const calibratedAxes = [0, 1, 2].map((axis) => {
    const known =
      axis === 2 && series.distance !== undefined
        ? series.reason === null
        : tags.every((entry) => octCalibratedAxes(entry)[axis]);
    return (
      !series.reason &&
      known &&
      !!grid &&
      close(grid.spacing[axis], declared[axis] ?? NaN)
    );
  });
  return { reason: series.reason, calibratedAxes };
}
