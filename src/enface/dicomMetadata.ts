import dicomParser, { type DataSet } from 'dicom-parser';
import { inflateSync } from 'fflate';
import { Tags } from '@/src/core/dicomTags';
import {
  octDirection,
  octGridGeometry,
  sameVector,
} from '@/src/enface/seriesGeometry';
import {
  isOCTMetadata,
  OCT_GEOMETRY_ERROR,
  OCT_SCAN_PATTERN,
} from '@/src/enface/detection';

const SHARED = 'x52009229';
const PER_FRAME = 'x52009230';
const MEASURES = 'x00289110';
const ORIENTATION = 'x00209116';
const POSITION = 'x00209113';
const sequenceTags = new Set([
  SHARED,
  PER_FRAME,
  MEASURES,
  ORIENTATION,
  POSITION,
  'x00221618',
  'x00283000',
  'x00289145',
]);

const firstItem = (data: DataSet | undefined, tag: string) =>
  data?.elements[tag]?.items?.[0]?.dataSet;
const stringValue = (data: DataSet | undefined, tag: string) =>
  data?.string(tag)?.trim();
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
  const measure = (tag: string) =>
    frameAttribute(shared, MEASURES, tag) ??
    frameAttribute(frames[0], MEASURES, tag) ??
    stringValue(data, tag);
  const orientation =
    frameAttribute(shared, ORIENTATION, 'x00200037') ??
    frameAttribute(frames[0], ORIENTATION, 'x00200037') ??
    stringValue(data, 'x00200037');
  const spacing = measure('x00280030');
  const positions = frames.map((frame) =>
    vector(frameAttribute(frame, POSITION, 'x00200032'))
  );
  const origin = positions[0]?.join('\\') ?? stringValue(data, 'x00200032');
  return {
    frames,
    declaredFrames: data.intString('x00280008'),
    orientation,
    spacing,
    positions,
    origin,
    sliceSpacing: measure('x00180088'),
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
    return value ? !sameVector(value, expected) : false;
  });
}

function positionError(geometry: ReturnType<typeof frameGeometry>) {
  const positions = geometry.positions.filter((p): p is number[] => !!p);
  if (positions.length > 0 && positions.length !== geometry.positions.length)
    return 'OCT frame positions are incomplete; spatial reconstruction is required.';
  const direction = octDirection(vector(geometry.orientation));
  if (positions.length > 1 && !direction)
    return 'OCT image orientation is missing; spatial reconstruction is required.';
  return octGridGeometry(positions, direction ?? undefined).reason;
}

function geometryError(geometry: ReturnType<typeof frameGeometry>) {
  if (
    geometry.frames.length &&
    geometry.declaredFrames !== geometry.frames.length
  )
    return 'OCT frame geometry does not match Number of Frames; spatial reconstruction is required.';
  const orientation = vector(geometry.orientation);
  if (orientation && !octDirection(orientation))
    return 'OCT image orientation is invalid; spatial reconstruction is required.';
  if (frameAttributeMismatch(geometry, MEASURES, 'x00280030', geometry.spacing))
    return 'OCT frames have different pixel spacing; spatial reconstruction is required.';
  if (
    frameAttributeMismatch(
      geometry,
      MEASURES,
      'x00180088',
      geometry.sliceSpacing
    )
  )
    return 'OCT frames have different slice spacing; spatial reconstruction is required.';
  if (
    frameAttributeMismatch(
      geometry,
      ORIENTATION,
      'x00200037',
      geometry.orientation
    )
  )
    return 'OCT frames are not parallel; spatial reconstruction is required.';
  return positionError(geometry);
}

function promoteOCTGeometry(data: DataSet, tags: Map<string, string>) {
  const geometry = frameGeometry(data);
  const set = (tag: string, value: string | undefined) => {
    if (value) tags.set(tag, value);
  };
  set(Tags.PixelSpacing, geometry.spacing);
  set(Tags.ImageOrientationPatient, geometry.orientation);
  set(Tags.ImagePositionPatient, geometry.origin);
  set(Tags.OphthalmicVolumetricPropertiesFlag, stringValue(data, 'x00221622'));
  set(OCT_SCAN_PATTERN, stringValue(firstItem(data, 'x00221618'), 'x00080100'));
  const reason = geometryError(geometry);
  set(OCT_GEOMETRY_ERROR, reason ?? undefined);
  const positions = geometry.positions;
  let sliceSpacing = geometry.sliceSpacing;
  if (!reason && positions[0] && positions[1]) {
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
          // Do not try to inflate a partial stream. Keep the existing full-file
          // path for deflated datasets, including trailing NULL padding.
          if (!isCompleteFile) {
            needsCompleteFile = true;
            throw new Error('Deflated OCT requires the complete dataset');
          }
          const inflated = inflateSync(bytes.subarray(position));
          // The parser requires the Part 10 header to retain metadata offsets.
          const complete = new Uint8Array(position + inflated.length);
          complete.set(bytes.subarray(0, position));
          complete.set(inflated, position);
          return complete;
        },
      });
      // A successful parse of a prefix can still end between metadata elements.
      // Only accept it once the complete Pixel Data header has been reached.
      if (isCompleteFile || data.elements.x7fe00010) return data;
    } catch (error) {
      if (isCompleteFile) throw error;
    }
    // Bound speculative reads before falling back to the original full-file
    // parse for unusually large headers or malformed inputs.
    length =
      needsCompleteFile || length >= 1024 * 1024
        ? file.size
        : Math.min(file.size, length * 4);
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
    tags.set(
      OCT_GEOMETRY_ERROR,
      'OCT spatial metadata could not be read; en face projection is unavailable.'
    );
  }
  return [...tags];
}
