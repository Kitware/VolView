import { Tags, type DicomDataset } from '@/packages/dicom/core';
import { dicomDatasetToTags } from '@/src/io/readDicomTags';
import { type OCTDataset, structuredOCTDataset } from './octDataset';
import { areEquals } from '@kitware/vtk.js/Common/Core/Math';
import {
  frameGridGeometry,
  imageDirection,
} from '@/src/core/streaming/dicom/frameGeometry';
import {
  isOCTMetadata,
  OCT_GEOMETRY_ERROR,
  OCT_SCAN_PATTERN,
} from '@/src/core/streaming/dicom/octMetadataTags';
import type { Maybe } from '@/src/types';

const finiteVector = (
  value: number[] | null | undefined,
  length: number
): value is number[] =>
  value?.length === length && value.every(Number.isFinite);
const positiveNumber = (value: number) => Number.isFinite(value) && value > 0;

const SHARED = '52009229';
const PER_FRAME = '52009230';
const MEASURES = '00289110';
const ORIENTATION = '00209116';
const POSITION = '00209113';
const SCAN_PATTERN = '00221618';
const ACQUISITION_PARAMETERS = '00221640';
const PIXEL_SPACING = Tags.PixelSpacing;
const SLICE_SPACING = Tags.SpacingBetweenSlices;
const IMAGE_ORIENTATION = Tags.ImageOrientationPatient;
const IMAGE_POSITION = Tags.ImagePositionPatient;
const firstItem = (data: OCTDataset | undefined, tag: string) =>
  data?.items(tag)[0];
const sequenceItems = (data: OCTDataset, tag: string) => data.items(tag);
const stringValue = (data: OCTDataset | undefined, tag: string) =>
  data?.value(tag)?.trim() || undefined;
const vector = (value: string | undefined) => value?.split('\\').map(Number);

function frameAttribute(
  data: OCTDataset | undefined,
  sequence: string,
  attribute: string
) {
  return stringValue(firstItem(data, sequence), attribute);
}

function frameGeometry(data: OCTDataset) {
  const shared = firstItem(data, SHARED);
  const frames = sequenceItems(data, PER_FRAME);
  // Shared groups take precedence over the first frame, then the top level.
  const attribute = (sequence: string, tag: string) =>
    frameAttribute(shared, sequence, tag) ??
    frameAttribute(frames[0], sequence, tag) ??
    stringValue(data, tag);
  const positions = frames.map((frame) =>
    vector(frameAttribute(frame, POSITION, IMAGE_POSITION))
  );
  return {
    frames,
    declaredFrames: Number.parseInt(
      stringValue(data, Tags.NumberOfFrames) ?? '',
      10
    ),
    orientation: attribute(ORIENTATION, IMAGE_ORIENTATION),
    spacing: attribute(MEASURES, PIXEL_SPACING),
    positions,
    origin: positions[0]?.join('\\') ?? stringValue(data, IMAGE_POSITION),
    sliceSpacing: attribute(MEASURES, SLICE_SPACING),
  };
}

function frameAttributeMismatch(
  geometry: ReturnType<typeof frameGeometry>,
  sequence: string,
  attribute: string,
  reference: string | undefined
) {
  const expected = vector(reference);
  if (!expected) return false;
  return geometry.frames.some((frame) => {
    const value = vector(frameAttribute(frame, sequence, attribute));
    return value
      ? !areEquals(value, expected, sequence === ORIENTATION ? 1e-4 : 1e-5)
      : false;
  });
}

function positionError(geometry: ReturnType<typeof frameGeometry>) {
  const positions = geometry.positions.filter((p): p is number[] => !!p);
  if (positions.length > 0 && positions.length !== geometry.positions.length)
    return 'OCT frame positions are incomplete; spatial reconstruction is required.';
  const direction = imageDirection(vector(geometry.orientation));
  if (positions.length > 1 && !direction)
    return 'OCT image orientation is missing; spatial reconstruction is required.';
  if (
    positions.length < 2 &&
    (geometry.declaredFrames ?? 0) > 1 &&
    !positiveNumber(Number(geometry.sliceSpacing))
  )
    return 'OCT slice spacing is unavailable; spatial reconstruction is required.';
  return frameGridGeometry(positions, direction).reason;
}

function geometryError(geometry: ReturnType<typeof frameGeometry>) {
  if (
    geometry.frames.length &&
    geometry.declaredFrames !== geometry.frames.length
  )
    return 'OCT frame geometry does not match Number of Frames; spatial reconstruction is required.';
  const orientation = vector(geometry.orientation);
  if (orientation && !imageDirection(orientation))
    return 'OCT image orientation is invalid; spatial reconstruction is required.';
  const origin = vector(geometry.origin);
  if (origin && !finiteVector(origin, 3))
    return 'DICOM slice positions are invalid; spatial reconstruction is required.';
  if (
    frameAttributeMismatch(geometry, MEASURES, PIXEL_SPACING, geometry.spacing)
  )
    return 'OCT frames have different pixel spacing; spatial reconstruction is required.';
  if (
    frameAttributeMismatch(
      geometry,
      MEASURES,
      SLICE_SPACING,
      geometry.sliceSpacing
    )
  )
    return 'OCT frames have different slice spacing; spatial reconstruction is required.';
  if (
    frameAttributeMismatch(
      geometry,
      ORIENTATION,
      IMAGE_ORIENTATION,
      geometry.orientation
    )
  )
    return 'OCT frames are not parallel; spatial reconstruction is required.';
  return positionError(geometry);
}

function scanPattern(data: OCTDataset) {
  const acquisitions = sequenceItems(data, ACQUISITION_PARAMETERS);
  const patterns = [data, ...acquisitions].flatMap((dataset) =>
    sequenceItems(dataset, SCAN_PATTERN).flatMap(
      (item) => stringValue(item, '00080100') ?? []
    )
  );
  return acquisitions.length > 1 || new Set(patterns).size > 1
    ? 'multiple'
    : patterns[0];
}

function promoteOCTGeometry(data: OCTDataset, tags: Map<string, string>) {
  const geometry = frameGeometry(data);
  const set = (tag: string, value: Maybe<string>) => {
    if (value) tags.set(tag, value);
  };
  set(Tags.PixelSpacing, geometry.spacing);
  set(
    Tags.OphthalmicVolumetricPropertiesFlag,
    stringValue(data, Tags.OphthalmicVolumetricPropertiesFlag)
  );
  set(OCT_SCAN_PATTERN, scanPattern(data));
  const reason = geometryError(geometry);
  set(OCT_GEOMETRY_ERROR, reason);
  if (reason) return;
  set(Tags.ImageOrientationPatient, geometry.orientation);
  set(Tags.ImagePositionPatient, geometry.origin);
  const positions = geometry.positions;
  let sliceSpacing = geometry.sliceSpacing;
  if (positions[0] && positions[1]) {
    sliceSpacing = String(
      Math.hypot(...positions.at(-1)!.map((n, i) => n - positions[0]![i])) /
        (positions.length - 1)
    );
  }
  set(Tags.SpacingBetweenSlices, sliceSpacing);
}

/** Application-only OCT eligibility and measurement metadata; raw core data stays unchanged. */
export function dicomMetadataForDisplay(dataset: DicomDataset) {
  const metadata = dicomDatasetToTags(dataset);
  if (!isOCTMetadata(metadata)) return metadata;
  const tags = new Map(metadata);
  promoteOCTGeometry(structuredOCTDataset(dataset), tags);
  return [...tags];
}
