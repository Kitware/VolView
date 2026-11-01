import { areEquals } from '@kitware/vtk.js/Common/Core/Math';
import { Tags } from '@/src/core/dicomTags';
import {
  frameGridGeometry,
  imageDirection,
  near,
} from '@/src/core/streaming/dicom/frameGeometry';
import { OCT_GEOMETRY_ERROR } from '@/src/core/streaming/dicom/octMetadataTags';

const TOLERANCE = 1e-5;

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
        ? !areEquals(spacing, other, TOLERANCE)
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

function loadedGridReason(
  grid: Grid | undefined,
  direction: number[],
  origin: number[],
  distance: number
) {
  if (
    grid &&
    (!areEquals(Array.from(grid.direction), direction, TOLERANCE) ||
      !areEquals(Array.from(grid.origin), origin, TOLERANCE) ||
      !near(grid.spacing[2], distance, TOLERANCE))
  )
    return 'The loaded DICOM grid does not match its file geometry; spatial reconstruction is required.';
  return null;
}

function seriesGeometry(tags: Map<string, string>[], grid?: Grid) {
  const declaredReason = declaredSeriesReason(tags);
  if (declaredReason) return { reason: declaredReason };
  const directions = tags.map((entry) =>
    imageDirection(vector(entry, Tags.ImageOrientationPatient, 6))
  );
  const [direction] = directions;
  if (
    !direction ||
    directions.some(
      (other) => !other || !areEquals(direction, other, TOLERANCE)
    )
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
  const reason = loadedGridReason(grid, direction, positions[0], distance);
  return { reason, distance };
}

function declaredPixelSpacing(tags: Map<string, string>, component: number) {
  const value = vector(tags, Tags.PixelSpacing, 2)?.[component] ?? NaN;
  return value > 0 ? value : NaN;
}

function calibratedAxes(
  tags: Map<string, string>[],
  grid: Grid | undefined,
  distance: number | undefined
) {
  const declared = [
    declaredPixelSpacing(tags[0], 1),
    declaredPixelSpacing(tags[0], 0),
    tags.length > 1 ? distance : Number(tags[0].get(Tags.SpacingBetweenSlices)),
  ];
  return declared.map((spacing, axis) => {
    if (!spacing || !Number.isFinite(spacing) || spacing <= 0) return false;
    if (grid && !near(Math.abs(grid.spacing[axis]), spacing, TOLERANCE))
      return false;
    return (
      axis === 2 ||
      tags.every((entry) =>
        near(declaredPixelSpacing(entry, 1 - axis), spacing, TOLERANCE)
      )
    );
  });
}

/** Validate source slice arrangement against the loaded grid. */
export function dicomSeriesGeometry(tags: Map<string, string>[], grid?: Grid) {
  if (!tags.length)
    return { reason: null, calibratedAxes: [false, false, false] };
  const geometry =
    tags.length > 1
      ? seriesGeometry(tags, grid)
      : {
          reason: tags[0].get(OCT_GEOMETRY_ERROR) ?? null,
          distance: undefined,
        };
  return {
    ...geometry,
    calibratedAxes: calibratedAxes(tags, grid, geometry.distance),
  };
}
