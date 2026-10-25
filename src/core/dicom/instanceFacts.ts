import type { InstanceFacts } from '@/src/core/dicom/planDicomCollections';
import { Tags } from '@/src/core/dicomTags';

/** A chunk's metadata as `readDicomTags` returns it: `[tag, value]` pairs. */
export type DicomTagValues = ReadonlyArray<readonly [string, string]>;

// readDicomTags hands back DICOM's own byte padding, so a value that is only
// padding is absent rather than an empty string.
const textOf = (metadata: DicomTagValues, tag: string) => {
  const found = metadata.find(([name]) => name === tag);
  const value = found?.[1].trim() ?? '';
  return value.length > 0 ? value : null;
};

// Hard facts are compared for equality, so '04', '4' and '4.0' must be one
// value. A value that is not a number keeps its own spelling.
const numericTextOf = (metadata: DicomTagValues, tag: string) => {
  const text = textOf(metadata, tag);
  if (text === null) return null;
  const value = Number(text);
  return Number.isFinite(value) ? String(value) : text;
};

const numberOf = (metadata: DicomTagValues, tag: string) => {
  const text = textOf(metadata, tag);
  if (text === null) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

// A blank component is absent, not zero: Number('') is 0, which would turn
// '1\\3' into the readable position [1, 0, 3].
const vectorOf = (metadata: DicomTagValues, tag: string, length: number) => {
  const text = textOf(metadata, tag);
  if (text === null) return null;
  const parts = text.split('\\').map((part) => part.trim());
  const values = parts.map(Number);
  return parts.length === length &&
    parts.every((part) => part.length > 0) &&
    values.every((value) => Number.isFinite(value))
    ? values
    : null;
};

const cross = (left: number[], right: number[]) => [
  left[1] * right[2] - left[2] * right[1],
  left[2] * right[0] - left[0] * right[2],
  left[0] * right[1] - left[1] * right[0],
];

const dot = (left: number[], right: number[]) =>
  left[0] * right[0] + left[1] * right[1] + left[2] * right[2];

/**
 * How far the row and column cosines may be from square, once each is scaled
 * to unit length, before they span no plane. GDCM allows a thousandth and
 * rescales any axis it is given, so a value printed to three decimals loads
 * as the scanner meant it while a skewed basis still does not.
 */
export const ORTHOGONALITY_TOLERANCE = 1e-3;

const magnitude = (axis: number[]) => Math.sqrt(dot(axis, axis));

/**
 * The axis scaled to unit length, or null when it has no length to scale. A
 * printed cosine is never exactly unit, so the length it was written with is
 * corrected rather than judged.
 */
const unitize = (axis: number[]) => {
  const size = magnitude(axis);
  return size > 0 ? axis.map((component) => component / size) : null;
};

/**
 * Row and column cosines, normalized, or null when they are not two axes
 * spanning a plane. A degenerate or skewed basis has no slice normal, so
 * nothing can be projected on it.
 */
const orientationOf = (metadata: DicomTagValues) => {
  const cosines = vectorOf(metadata, Tags.ImageOrientationPatient, 6);
  if (cosines === null) return null;

  const row = unitize(cosines.slice(0, 3));
  const column = unitize(cosines.slice(3, 6));
  if (row === null || column === null) return null;
  if (Math.abs(dot(row, column)) > ORTHOGONALITY_TOLERANCE) return null;

  return [...row, ...column];
};

/**
 * The slice normal of a validated orientation: the row cosines crossed with
 * the column cosines, which is only the z axis for an axial acquisition.
 * Unit length to within the orthogonality tolerance, since the two axes are
 * unit and square to it.
 */
export const sliceNormalOf = (orientation: number[] | null) =>
  orientation === null
    ? null
    : cross(orientation.slice(0, 3), orientation.slice(3, 6));

/** Where a position sits along a slice normal, in mm. */
export const projectOnNormal = (
  normal: number[] | null,
  position: number[] | null
) => (normal === null || position === null ? null : dot(normal, position));

// A pixel spacing of zero or less places no sample anywhere.
const pixelSpacingOf = (metadata: DicomTagValues) => {
  const spacing = vectorOf(metadata, Tags.PixelSpacing, 2);
  return spacing !== null && spacing.every((value) => value > 0)
    ? spacing
    : null;
};

/**
 * Where an instance places its samples, for callers that need nothing else.
 * Reading it costs three tag lookups rather than the twenty a full fact read
 * takes, which a volume of two thousand slices notices.
 */
export function readGeometryFacts(metadata: DicomTagValues) {
  return {
    orientation: orientationOf(metadata),
    position: vectorOf(metadata, Tags.ImagePositionPatient, 3),
    pixelSpacing: pixelSpacingOf(metadata),
  };
}

/** Reads the planner's plain facts out of one instance's tag values. */
export function readInstanceFacts(metadata: DicomTagValues): InstanceFacts {
  const { orientation, position, pixelSpacing } = readGeometryFacts(metadata);

  return {
    sopInstanceUid: textOf(metadata, Tags.SOPInstanceUID),
    seriesInstanceUid: textOf(metadata, Tags.SeriesInstanceUID),
    seriesNumber: numericTextOf(metadata, Tags.SeriesNumber),
    sequenceName: textOf(metadata, Tags.SequenceName),
    sliceThickness: numericTextOf(metadata, Tags.SliceThickness),
    seriesDate: textOf(metadata, Tags.SeriesDate),
    rows: numericTextOf(metadata, Tags.Rows),
    columns: numericTextOf(metadata, Tags.Columns),
    samplesPerPixel: numericTextOf(metadata, Tags.SamplesPerPixel),
    numberOfFrames: numericTextOf(metadata, Tags.NumberOfFrames),
    orientation,
    position,
    projectedPosition: projectOnNormal(sliceNormalOf(orientation), position),
    pixelSpacing,
    instanceNumber: numberOf(metadata, Tags.InstanceNumber),
    acquisitionNumber: numericTextOf(metadata, Tags.AcquisitionNumber),
    temporalPositionIdentifier: numericTextOf(
      metadata,
      Tags.TemporalPositionIdentifier
    ),
    echoNumbers: numericTextOf(metadata, Tags.EchoNumbers),
    diffusionBValue: numericTextOf(metadata, Tags.DiffusionBValue),
  };
}

// Carries a separator no UID can hold, so a fallback key never equals a real
// series key.
const NO_SERIES_UID = 'no-series';

/**
 * The grouping key for one instance's series. Instances of different series
 * are planned independently.
 */
export function seriesKeyOf(metadata: DicomTagValues) {
  const seriesUid = textOf(metadata, Tags.SeriesInstanceUID);
  if (seriesUid !== null) return seriesUid;

  // Escaped, so moving a separator from one part to the other changes the key.
  return [
    NO_SERIES_UID,
    encodeURIComponent(textOf(metadata, Tags.StudyInstanceUID) ?? ''),
    encodeURIComponent(textOf(metadata, Tags.PatientID) ?? ''),
  ].join('|');
}
