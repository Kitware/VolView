import { Tags } from '@/src/core/dicomTags';

import {
  coordinatesMatch,
  frameGridGeometry,
  imageDirection,
  numbersMatch,
} from '@/src/core/streaming/dicom/frameGeometry';
import { OCT_GEOMETRY_ERROR } from '@/src/core/streaming/dicom/octMetadataTags';

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

function declaredSeriesReason(tags: Map<string, string>[]) {
  const reason = tags
    .map((entry) => entry.get(OCT_GEOMETRY_ERROR))
    .find(Boolean);
  if (reason) return reason;
  const sop = tags[0].get(Tags.SOPClassUID)?.trim();
  if (tags.some((entry) => entry.get(Tags.SOPClassUID)?.trim() !== sop))
    return 'The DICOM files have incompatible image types; spatial reconstruction is required.';
  const spacing = vector(tags[0], Tags.PixelSpacing, 2);
  if (
    tags.some((entry) => {
      const other = vector(entry, Tags.PixelSpacing, 2);
      return spacing && other
        ? !coordinatesMatch(spacing, other)
        : spacing !== other;
    })
  )
    return 'The DICOM files have inconsistent pixel spacing; spatial reconstruction is required.';
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
        Number.isFinite(declared) &&
        declared > 0 &&
        !numbersMatch(declared, distance)
      );
    })
  )
    return 'The DICOM slice spacing disagrees with its file positions; spatial reconstruction is required.';
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
    (!coordinatesMatch(grid.direction, direction) ||
      !coordinatesMatch(grid.origin, origin) ||
      !numbersMatch(grid.spacing[2], distance))
  )
    return 'The loaded DICOM grid does not match its file geometry; spatial reconstruction is required.';
  return null;
}

function seriesGeometry(tags: Map<string, string>[], grid?: Grid) {
  const declaredReason = declaredSeriesReason(tags);
  if (declaredReason) return { reason: declaredReason };
  const direction = imageDirection(
    vector(tags[0], Tags.ImageOrientationPatient, 6)
  );
  if (
    !direction ||
    tags.some((entry) => {
      const other = imageDirection(
        vector(entry, Tags.ImageOrientationPatient, 6)
      );
      return !other || !coordinatesMatch(direction, other);
    })
  )
    return {
      reason:
        'The DICOM files have missing or inconsistent image orientation; spatial reconstruction is required.',
    };
  const positions = seriesPositions(tags);
  if (!positions)
    return {
      reason:
        'The DICOM files have incomplete or invalid slice positions; spatial reconstruction is required.',
    };
  const geometry = frameGridGeometry(positions, direction);
  if (geometry.reason) return geometry;
  const distance = geometry.distance!;
  const reason =
    sliceSpacingReason(tags, distance) ||
    loadedGridReason(grid, direction, positions[0], distance);
  return { reason, distance };
}

/** Validate source slice arrangement against the loaded grid. */
export function dicomSeriesGeometry(
  metadata: readonly Iterable<[string, string]>[],
  grid?: Grid
) {
  const tags = metadata.map((entry) => new Map(entry));
  if (!tags.length) return { reason: null };
  return tags.length > 1
    ? seriesGeometry(tags, grid)
    : { reason: tags[0].get(OCT_GEOMETRY_ERROR) ?? null };
}
