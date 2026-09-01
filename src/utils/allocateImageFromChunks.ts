import { Chunk } from '@/src/core/streaming/chunk';
import { Maybe } from '@/src/types';
import { NAME_TO_TAG } from '@/src/core/dicomTags';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { Vector3 } from '@kitware/vtk.js/types';
import { mat3, vec3 } from 'gl-matrix';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

const ImagePositionPatientTag = NAME_TO_TAG.get('ImagePositionPatient')!;
const ImageOrientationPatientTag = NAME_TO_TAG.get('ImageOrientationPatient')!;
const PixelSpacingTag = NAME_TO_TAG.get('PixelSpacing')!;
const SpacingBetweenSlicesTag = NAME_TO_TAG.get('SpacingBetweenSlices')!;
const RowsTag = NAME_TO_TAG.get('Rows')!;
const ColumnsTag = NAME_TO_TAG.get('Columns')!;
const BitsStoredTag = NAME_TO_TAG.get('BitsStored')!;
const PixelRepresentationTag = NAME_TO_TAG.get('PixelRepresentation')!;
const SamplesPerPixelTag = NAME_TO_TAG.get('SamplesPerPixel')!;
const RescaleIntercept = NAME_TO_TAG.get('RescaleIntercept')!;
const RescaleSlope = NAME_TO_TAG.get('RescaleSlope')!;
const NumberOfFrames = NAME_TO_TAG.get('NumberOfFrames')!;

function toVec(s: Maybe<string>): number[] | null {
  if (!s?.length) return null;
  return s.split('\\').map((a) => Number(a)) as number[];
}

function isPositiveFiniteNumber(value: number) {
  return Number.isFinite(value) && value > 0;
}

function getBitStorageSize(num: number, signed: boolean) {
  const addSignedBit = signed ? 1 : 0;
  const val = num < 0 ? -num : num + 1; // range shift for log2
  const nbits = Math.ceil(Math.log2(val) + addSignedBit);
  // round up to a word size
  return 2 ** Math.ceil(Math.log2(nbits));
}

type TypedArrayConstructor =
  | typeof Int8Array
  | typeof Uint8Array
  | typeof Int16Array
  | typeof Uint16Array
  | typeof Int32Array
  | typeof Uint32Array;

const TYPED_ARRAY_VALUE_RANGES = new Map<
  TypedArrayConstructor,
  { min: number; max: number }
>([
  [Int8Array, { min: -(2 ** 7), max: 2 ** 7 - 1 }],
  [Uint8Array, { min: 0, max: 2 ** 8 - 1 }],
  [Int16Array, { min: -(2 ** 15), max: 2 ** 15 - 1 }],
  [Uint16Array, { min: 0, max: 2 ** 16 - 1 }],
  [Int32Array, { min: -(2 ** 31), max: 2 ** 31 - 1 }],
  [Uint32Array, { min: 0, max: 2 ** 32 - 1 }],
]);

/**
 * The values a buffer of the given element type can hold without wrapping.
 * Undefined for element types the allocator never produces, floats included.
 */
export function getTypedArrayValueRange(ctor: unknown) {
  return TYPED_ARRAY_VALUE_RANGES.get(ctor as TypedArrayConstructor);
}

/**
 * The values `buffer` can hold without wrapping, or undefined if its element
 * type has no fixed integer range to enforce.
 */
export function getBufferValueRange(buffer: ArrayBufferView) {
  return getTypedArrayValueRange(buffer.constructor);
}

/**
 * Whether a decoded value range is representable in `buffer`'s element type.
 * A buffer with no enforceable range accepts everything.
 */
export function valuesFitBuffer(
  range: { min: number; max: number },
  buffer: ArrayBufferView
) {
  const bufferRange = getBufferValueRange(buffer);
  if (!bufferRange) return true;
  return range.min >= bufferRange.min && range.max <= bufferRange.max;
}

/**
 * Whether every sample is a whole number, which an integer-element buffer
 * needs. Integer typed arrays hold nothing else, so only float or plain
 * arrays are scanned. A buffer with no integer range accepts everything.
 */
export function samplesAreIntegral(
  values: ArrayLike<number>,
  buffer: ArrayBufferView
) {
  if (!getBufferValueRange(buffer)) return true;
  if (
    ArrayBuffer.isView(values) &&
    !(values instanceof Float32Array) &&
    !(values instanceof Float64Array)
  ) {
    return true;
  }
  return Array.prototype.every.call(values, (value: number) =>
    Number.isInteger(value)
  );
}

export function getTypedArrayForDataRange(min: number, max: number) {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max))
    throw new Error('Input must be integers');

  const isSigned = min < 0;
  const nbits = getBitStorageSize(
    Math.abs(min) > Math.abs(max) ? min : max,
    isSigned
  );

  if (nbits <= 8) return isSigned ? Int8Array : Uint8Array;
  if (nbits <= 16) return isSigned ? Int16Array : Uint16Array;
  if (nbits <= 32) return isSigned ? Int32Array : Uint32Array;

  throw new Error(`Cannot handle ${nbits}-bit sized ranges`);
}

function numberOr(value: Maybe<string>, fallback: number) {
  const text = value?.trim();
  if (!text) return fallback;
  const num = Number(text);
  return Number.isFinite(num) ? num : fallback;
}

/**
 * The tags that decide what values an instance decodes to.
 *
 * A bitsStored of 0 means the tag was absent or unparseable. It is not a DICOM
 * default: BitsStored is Type 1, so a conforming instance always carries one.
 */
export function getPixelFormat(metadata: Maybe<Iterable<[string, string]>>) {
  const meta = new Map(metadata ?? []);
  return {
    bitsStored: numberOr(meta.get(BitsStoredTag), 0),
    pixelRepresentation: numberOr(meta.get(PixelRepresentationTag), 0),
    rescaleSlope: numberOr(meta.get(RescaleSlope), 1),
    rescaleIntercept: numberOr(meta.get(RescaleIntercept), 0),
  };
}

type PixelFormat = ReturnType<typeof getPixelFormat>;

/**
 * The values an instance can decode to. ITK/GDCM applies RescaleSlope and
 * RescaleIntercept while decoding, so this is the range after rescaling.
 *
 * Null when BitsStored is missing, since nothing can be derived without it.
 */
export function getRescaledValueRange(format: PixelFormat) {
  const { bitsStored, pixelRepresentation, rescaleSlope, rescaleIntercept } =
    format;
  if (!Number.isInteger(bitsStored) || bitsStored <= 0) return null;

  const isSigned = pixelRepresentation === 1;
  const storedMin = isSigned ? -(2 ** (bitsStored - 1)) : 0;
  const storedMax = 2 ** (bitsStored - (isSigned ? 1 : 0)) - 1;
  const a = storedMin * rescaleSlope + rescaleIntercept;
  const b = storedMax * rescaleSlope + rescaleIntercept;

  return { min: Math.min(a, b), max: Math.max(a, b) };
}

/**
 * The element type a volume allocated from instances of these formats holds.
 *
 * An instance whose tags give no finite range is left out of the union and
 * judged on its decoded values by the containment guard instead.
 */
export function getVolumeBufferType(formats: PixelFormat[]) {
  const usable = formats.flatMap((format) => {
    const range = getRescaledValueRange(format);
    return range && Number.isFinite(range.min) && Number.isFinite(range.max)
      ? [{ format, range }]
      : [];
  });
  if (usable.length === 0)
    throw new Error('No instance declares a finite modality rescale range');

  const needsFloat64 = usable.some(
    ({ format, range }) =>
      !Number.isInteger(format.rescaleSlope) ||
      !Number.isInteger(format.rescaleIntercept) ||
      !Number.isSafeInteger(range.min) ||
      !Number.isSafeInteger(range.max)
  );
  if (needsFloat64) return Float64Array;

  const min = Math.min(...usable.map(({ range }) => range.min));
  const max = Math.max(...usable.map(({ range }) => range.max));
  const exceedsSigned32 = min < 0 && (min < -(2 ** 31) || max > 2 ** 31 - 1);
  const exceedsUnsigned32 = min >= 0 && max > 2 ** 32 - 1;
  if (exceedsSigned32 || exceedsUnsigned32) return Float64Array;

  // NOTE(fli): might be better to assume (u)int16 and re-allocate to (u)int32
  // if needed, since the data range might actually fit in a smaller datatype.
  return getTypedArrayForDataRange(min, max);
}

export function allocateImageFromChunks(sortedChunks: Chunk[]) {
  if (sortedChunks.length === 0) {
    throw new Error('Cannot allocate an image from zero chunks');
  }

  // use the first chunk as the source of metadata
  const meta = new Map(sortedChunks[0].metadata!);
  const imagePositionPatient = toVec(meta.get(ImagePositionPatientTag));
  const imageOrientationPatient = toVec(meta.get(ImageOrientationPatientTag));
  const pixelSpacing = toVec(meta.get(PixelSpacingTag));
  const spacingBetweenSlices = Number(meta.get(SpacingBetweenSlicesTag));
  const rows = Number(meta.get(RowsTag) ?? 0);
  const columns = Number(meta.get(ColumnsTag) ?? 0);
  const volumeFormats = sortedChunks.map((chunk) =>
    getPixelFormat(chunk.metadata)
  );
  const samplesPerPixel = Number(meta.get(SamplesPerPixelTag) ?? 1);
  const numberOfFrames = meta.has(NumberOfFrames)
    ? Number(meta.get(NumberOfFrames))
    : null;

  if (
    numberOfFrames !== null &&
    numberOfFrames > 1 &&
    sortedChunks.length > 1
  ) {
    throw new Error(
      'First chunk in a group of chunks (size > 1) is a multi-frame chunk'
    );
  }

  // We don't support volumes with multiple chunks/files with multi-frame data at the moment.
  // Some CT modality series have NumberOfFrames === 1, so use the number of chunks if more than 1 chunk.
  const slices =
    sortedChunks.length > 1 ? sortedChunks.length : (numberOfFrames ?? 1);
  const TypedArrayCtor = getVolumeBufferType(volumeFormats);
  const pixelData = new TypedArrayCtor(
    rows * columns * slices * samplesPerPixel
  );

  const image = vtkImageData.newInstance();
  image.setExtent([0, columns - 1, 0, rows - 1, 0, slices - 1]);

  if (imagePositionPatient) {
    image.setOrigin(imagePositionPatient as Vector3);
  }

  const spacing: Vector3 = [1, 1, 1];
  if (
    pixelSpacing &&
    pixelSpacing.length >= 2 &&
    isPositiveFiniteNumber(pixelSpacing[0]) &&
    isPositiveFiniteNumber(pixelSpacing[1])
  ) {
    spacing[0] = pixelSpacing[1];
    spacing[1] = pixelSpacing[0];
  }

  if (imagePositionPatient && sortedChunks.length > 1) {
    const lastMeta = new Map(sortedChunks[sortedChunks.length - 1].metadata);
    const lastIPP = toVec(lastMeta.get(ImagePositionPatientTag));
    if (lastIPP) {
      // assumption: uniform Z spacing
      const zVec = vec3.create();
      vec3.sub(zVec, lastIPP as vec3, imagePositionPatient as vec3);
      spacing[2] = vec3.len(zVec) / (slices - 1) || 1;
    }
  } else if (slices === 1 && isPositiveFiniteNumber(spacingBetweenSlices)) {
    spacing[2] = spacingBetweenSlices;
  }
  image.setSpacing(spacing);

  if (imageOrientationPatient) {
    const zDir = vec3.create() as Vector3;
    vec3.cross(
      zDir,
      imageOrientationPatient.slice(0, 3) as vec3,
      imageOrientationPatient.slice(3, 6) as vec3
    );
    image.setDirection([...imageOrientationPatient, ...zDir] as mat3);
  }

  const dataArray = vtkDataArray.newInstance({
    numberOfComponents: samplesPerPixel,
    values: pixelData,
  });
  image.getPointData().setScalars(dataArray);

  // Needed for volume rendering to work at start
  // TODO(fli) sane defaults?
  dataArray.setRange({ min: 0, max: 255 }, 0);

  return image;
}
