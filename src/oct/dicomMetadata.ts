import dicomParser, { type DataSet } from 'dicom-parser';
import { Tags } from '@/src/core/dicomTags';
import { augmentOCTPadding } from '@/src/oct/padding';
import {
  isOCTMetadata,
  OCT_GEOMETRY_ERROR,
  OCT_SCAN_PATTERN,
} from '@/src/oct/detection';

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
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-5;
const sameVector = (a: number[], b: number[]) =>
  a.length === b.length && a.every((value, i) => close(value, b[i]));

function frameAttribute(
  data: DataSet | undefined,
  sequence: string,
  attribute: string
) {
  return stringValue(firstItem(data, sequence), attribute);
}

function geometryString(
  primary: DataSet | undefined,
  data: DataSet,
  tag: string
) {
  return stringValue(primary, tag) ?? stringValue(data, tag);
}

function frameGeometry(data: DataSet) {
  const shared = firstItem(data, SHARED);
  const frames =
    data.elements[PER_FRAME]?.items?.flatMap((item) =>
      item.dataSet ? [item.dataSet] : []
    ) ?? [];
  const measures =
    firstItem(shared, MEASURES) ?? firstItem(frames[0], MEASURES);
  const orientation =
    frameAttribute(shared, ORIENTATION, 'x00200037') ??
    frameAttribute(frames[0], ORIENTATION, 'x00200037') ??
    stringValue(data, 'x00200037');
  const spacing = geometryString(measures, data, 'x00280030');
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
    sliceSpacing: geometryString(measures, data, 'x00180088'),
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

function validOrientation(orientation: number[]) {
  if (orientation.length !== 6 || !orientation.every(Number.isFinite))
    return false;
  const row = orientation.slice(0, 3);
  const column = orientation.slice(3);
  return (
    close(Math.hypot(...row), 1) &&
    close(Math.hypot(...column), 1) &&
    close(
      row.reduce((dot, n, i) => dot + n * column[i], 0),
      0
    )
  );
}

function followsGrid(step: number[], orientation: number[] | undefined) {
  if (!orientation) return true;
  if (!validOrientation(orientation)) return false;
  const normal = [
    orientation[1] * orientation[5] - orientation[2] * orientation[4],
    orientation[2] * orientation[3] - orientation[0] * orientation[5],
    orientation[0] * orientation[4] - orientation[1] * orientation[3],
  ];
  const distance = step.reduce((sum, value, i) => sum + value * normal[i], 0);
  return (
    distance > 0 &&
    sameVector(
      step,
      normal.map((n) => n * distance)
    )
  );
}

function positionError(geometry: ReturnType<typeof frameGeometry>) {
  const positions = geometry.positions.filter((p): p is number[] => !!p);
  if (positions.length > 0 && positions.length !== geometry.positions.length)
    return 'OCT frame positions are incomplete; spatial reconstruction is required.';
  if (positions.some((p) => p.length !== 3 || !p.every(Number.isFinite)))
    return 'OCT frame positions are invalid; spatial reconstruction is required.';
  if (positions.length < 2) return null;
  const step = positions[1].map((p, i) => p - positions[0][i]);
  if (!step.some((n) => Math.abs(n) > 1e-5))
    return 'Repeated OCT B-scan locations need spatial reconstruction.';
  if (!followsGrid(step, vector(geometry.orientation)))
    return 'OCT frame positions do not follow the image grid; spatial reconstruction is required.';
  if (
    positions.some(
      (p, frame) =>
        !sameVector(
          p,
          positions[0].map((n, i) => n + frame * step[i])
        )
    )
  )
    return 'OCT B-scans have nonuniform positions; spatial reconstruction is required.';
  return null;
}

function geometryError(geometry: ReturnType<typeof frameGeometry>) {
  if (
    geometry.frames.length &&
    geometry.declaredFrames !== geometry.frames.length
  )
    return 'OCT frame geometry does not match Number of Frames; spatial reconstruction is required.';
  const orientation = vector(geometry.orientation);
  if (orientation && !validOrientation(orientation))
    return 'OCT image orientation is invalid; spatial reconstruction is required.';
  if (frameAttributeMismatch(geometry, MEASURES, 'x00280030', geometry.spacing))
    return 'OCT frames have different pixel spacing; spatial reconstruction is required.';
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

/** Promotes enhanced OCT geometry to the grid metadata used by the loader. */
export async function augmentOCTMetadata(
  file: Blob,
  metadata: Array<[string, string]>
) {
  if (!isOCTMetadata(metadata)) return metadata;
  const tags = new Map(metadata);
  try {
    const data = dicomParser.parseDicom(
      new Uint8Array(await file.arrayBuffer()),
      {
        untilTag: 'x7fe00010',
        vrCallback: (tag) => (sequenceTags.has(tag) ? 'SQ' : undefined),
      }
    );
    augmentOCTPadding(data, tags);
    const geometry = frameGeometry(data);
    const set = (tag: string, value: string | undefined) => {
      if (value) tags.set(tag, value);
    };
    set(Tags.PixelSpacing, geometry.spacing);
    set(Tags.ImageOrientationPatient, geometry.orientation);
    set(Tags.ImagePositionPatient, geometry.origin);
    set(
      Tags.OphthalmicVolumetricPropertiesFlag,
      stringValue(data, 'x00221622')
    );
    set(
      OCT_SCAN_PATTERN,
      stringValue(firstItem(data, 'x00221618'), 'x00080100')
    );
    const reason = geometryError(geometry);
    set(OCT_GEOMETRY_ERROR, reason ?? undefined);
    const positions = geometry.positions;
    let sliceSpacing = geometry.sliceSpacing;
    if (!reason && positions[0] && positions[1]) {
      sliceSpacing = String(
        Math.hypot(...positions[1].map((n, i) => n - positions[0]![i]))
      );
    }
    set(Tags.SpacingBetweenSlices, sliceSpacing);
  } catch {
    tags.set(
      OCT_GEOMETRY_ERROR,
      'OCT spatial metadata could not be read; en face projection is unavailable.'
    );
  }
  return [...tags];
}
