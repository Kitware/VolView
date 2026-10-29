import dicomParser, { type DataSet } from 'dicom-parser';
import { inflateSync } from 'fflate';
import { Tags, toDicomParserKey } from '@/src/core/dicomTags';
import {
  coordinatesMatch,
  frameGridGeometry,
  imageDirection,
} from '@/src/core/streaming/dicom/frameGeometry';
import {
  isOCTMetadata,
  OCT_GEOMETRY_ERROR,
  OCT_SCAN_PATTERN,
} from '@/src/core/streaming/dicom/octMetadataTags';

const finiteVector = (
  value: number[] | null | undefined,
  length: number
): value is number[] =>
  value?.length === length && value.every(Number.isFinite);
const positiveNumber = (value: number) => Number.isFinite(value) && value > 0;

const SHARED = 'x52009229';
const PER_FRAME = 'x52009230';
const MEASURES = 'x00289110';
const ORIENTATION = 'x00209116';
const POSITION = 'x00209113';
const SCAN_PATTERN = 'x00221618';
const ACQUISITION_PARAMETERS = 'x00221640';
const PIXEL_SPACING = toDicomParserKey(Tags.PixelSpacing);
const SLICE_SPACING = toDicomParserKey(Tags.SpacingBetweenSlices);
const IMAGE_ORIENTATION = toDicomParserKey(Tags.ImageOrientationPatient);
const IMAGE_POSITION = toDicomParserKey(Tags.ImagePositionPatient);
const sequenceTags = new Set([
  SHARED,
  PER_FRAME,
  MEASURES,
  ORIENTATION,
  POSITION,
  SCAN_PATTERN,
  ACQUISITION_PARAMETERS,
  'x00283000',
  'x00289145',
]);

const firstItem = (data: DataSet | undefined, tag: string) =>
  data?.elements[tag]?.items?.[0]?.dataSet;
const stringValue = (data: DataSet | undefined, tag: string) =>
  data?.string(tag)?.trim() || undefined;
const vector = (value: string | undefined) => value?.split('\\').map(Number);

function frameAttribute(
  data: DataSet | undefined,
  sequence: string,
  attribute: string
) {
  return stringValue(firstItem(data, sequence), attribute);
}

function frameGeometry(data: DataSet) {
  const shared = firstItem(data, SHARED);
  const frames =
    data.elements[PER_FRAME]?.items?.flatMap((item) =>
      item.dataSet ? [item.dataSet] : []
    ) ?? [];
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
    declaredFrames: data.intString(toDicomParserKey(Tags.NumberOfFrames)),
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
      ? !coordinatesMatch(
          value,
          expected,
          sequence === ORIENTATION ? 1e-4 : 1e-5
        )
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
  return frameGridGeometry(positions, direction ?? undefined).reason;
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

function scanPattern(data: DataSet) {
  const acquisitions =
    data.elements[ACQUISITION_PARAMETERS]?.items?.flatMap((item) =>
      item.dataSet ? [item.dataSet] : []
    ) ?? [];
  const patterns = [data, ...acquisitions].flatMap(
    (dataset) =>
      dataset.elements[SCAN_PATTERN]?.items?.flatMap((item) => {
        const code = stringValue(item.dataSet, 'x00080100');
        return code ? [code] : [];
      }) ?? []
  );
  return acquisitions.length > 1 || new Set(patterns).size > 1
    ? 'multiple'
    : patterns[0];
}

function promoteOCTGeometry(data: DataSet, tags: Map<string, string>) {
  const geometry = frameGeometry(data);
  const set = (tag: string, value: string | undefined) => {
    if (value) tags.set(tag, value);
  };
  set(Tags.PixelSpacing, geometry.spacing);
  set(
    Tags.OphthalmicVolumetricPropertiesFlag,
    stringValue(data, toDicomParserKey(Tags.OphthalmicVolumetricPropertiesFlag))
  );
  set(OCT_SCAN_PATTERN, scanPattern(data));
  const reason = geometryError(geometry);
  set(OCT_GEOMETRY_ERROR, reason ?? undefined);
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

async function readOCTHeader(file: Blob) {
  let length = Math.min(file.size, 64 * 1024);
  for (;;) {
    const isCompleteFile = length === file.size;
    const headerBytes = new Uint8Array(
      await file.slice(0, length).arrayBuffer()
    );
    let needsCompleteFile = false;
    try {
      const data = dicomParser.parseDicom(headerBytes, {
        untilTag: 'x7fe00010',
        vrCallback: (tag) => (sequenceTags.has(tag) ? 'SQ' : undefined),
        inflater: (bytes, position) => {
          // Inflate only the complete stream, including trailing NULL padding.
          if (!isCompleteFile) {
            needsCompleteFile = true;
            throw new Error('Deflated OCT requires the complete dataset');
          }
          const inflated = inflateSync(bytes.subarray(position));
          const complete = new Uint8Array(position + inflated.length);
          complete.set(bytes.subarray(0, position));
          complete.set(inflated, position);
          // The inflater resumes at zero. Skip the Part 10 header as one OB
          // element while retaining the file-meta offsets in the same buffer.
          complete.fill(0, 0, 12);
          complete.set([0x4f, 0x42], 4);
          new DataView(complete.buffer).setUint32(8, position - 12, true);
          return complete;
        },
      });
      // A successful parse of a prefix can still end between metadata elements.
      // Only accept it once the complete Pixel Data header has been reached.
      if (isCompleteFile || data.elements.x7fe00010) return data;
    } catch (error) {
      if (isCompleteFile) throw error;
    }
    length = needsCompleteFile ? file.size : Math.min(file.size, length * 4);
  }
}

/** Promotes enhanced OCT geometry for the loader. */
export async function augmentOCTMetadata(
  file: Blob,
  metadata: Array<[string, string]>
) {
  if (!isOCTMetadata(metadata)) return metadata;
  const tags = new Map(metadata);
  try {
    const data = await readOCTHeader(file);
    promoteOCTGeometry(data, tags);
  } catch {
    tags.set(OCT_GEOMETRY_ERROR, 'OCT spatial metadata could not be read.');
  }
  return [...tags];
}
