import type { DicomDataset } from '../metadata/dicomDataset';
import { getDatasetTag } from '../metadata/datasetAccess';
import { getFrameTag } from '../metadata/functionalGroups';
import { readModalityRescale } from '../metadata/modalityRescale';
import { numberOr } from '../utils';

const BitsStoredTag = '00280101';
const PixelRepresentationTag = '00280103';
const NumberOfFramesTag = '00280008';

function getBitStorageSize(num: number, signed: boolean) {
  const addSignedBit = signed ? 1 : 0;
  const val = num < 0 ? -num : num + 1; // range shift for log2
  const nbits = Math.ceil(Math.log2(val) + addSignedBit);
  // round up to a word size
  return 2 ** Math.ceil(Math.log2(nbits));
}

type IntegerArrayConstructor =
  | typeof Int8Array
  | typeof Uint8Array
  | typeof Int16Array
  | typeof Uint16Array
  | typeof Int32Array
  | typeof Uint32Array;

export type VolumeBufferConstructor =
  | IntegerArrayConstructor
  | typeof Float32Array
  | typeof Float64Array;
export type VolumeBuffer = InstanceType<VolumeBufferConstructor>;

const TYPED_ARRAY_VALUE_RANGES = new Map<
  IntegerArrayConstructor,
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
  return TYPED_ARRAY_VALUE_RANGES.get(ctor as IntegerArrayConstructor);
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

/**
 * The tags that decide what values an instance decodes to.
 *
 * A bitsStored of 0 means the tag was absent or unparseable. It is not a DICOM
 * default: BitsStored is Type 1, so a conforming instance always carries one.
 */
export function getPixelFormat(
  metadata: DicomDataset | null | undefined,
  frameIndex = 0
) {
  const valueOf = (tag: string) => getFrameTag(metadata, tag, frameIndex);
  return {
    bitsStored: numberOr(valueOf(BitsStoredTag), 0),
    pixelRepresentation: numberOr(valueOf(PixelRepresentationTag), 0),
    ...readModalityRescale(metadata, frameIndex),
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

const FLOAT32_EXACT_INTEGER = 2 ** 24;
const FLOAT32_RELATIVE_STEP = 2 ** -23;
const FLOAT32_MAX_BITS_STORED = 24;

const magnitude = ({ min, max }: { min: number; max: number }) =>
  Math.max(Math.abs(min), Math.abs(max));

const isIntegralRescale = (format: {
  rescaleSlope: number;
  rescaleIntercept: number;
}) =>
  Number.isInteger(format.rescaleSlope) &&
  Number.isInteger(format.rescaleIntercept);

/** Float32 holds every integer up to 2^24 exactly. */
const float32KeepsIntegers = (range: { min: number; max: number }) =>
  magnitude(range) <= FLOAT32_EXACT_INTEGER;

/** Float32's spacing near `range` stays below one stored step of `slope`. */
const float32KeepsSteps = (
  range: { min: number; max: number },
  slope: number
) => slope !== 0 && magnitude(range) * FLOAT32_RELATIVE_STEP < Math.abs(slope);

/**
 * Whether a float32 buffer holds `range` as the rescale requires: integral
 * values exactly, fractional ones with adjacent stored steps kept apart.
 */
export const float32Holds = (
  range: { min: number; max: number },
  format: { rescaleSlope: number; rescaleIntercept: number }
) =>
  isIntegralRescale(format)
    ? float32KeepsIntegers(range)
    : float32KeepsSteps(range, format.rescaleSlope);

type UsableFormat = {
  format: PixelFormat;
  range: { min: number; max: number };
};

function fractionalBufferType(usable: UsableFormat[]) {
  return usable.every(
    ({ format, range }) =>
      format.bitsStored <= FLOAT32_MAX_BITS_STORED &&
      float32KeepsSteps(range, format.rescaleSlope)
  )
    ? Float32Array
    : Float64Array;
}

function integralBufferType(usable: UsableFormat[]): VolumeBufferConstructor {
  if (
    usable.some(
      ({ range }) =>
        !Number.isSafeInteger(range.min) || !Number.isSafeInteger(range.max)
    )
  )
    return Float64Array;
  const min = Math.min(...usable.map(({ range }) => range.min));
  const max = Math.max(...usable.map(({ range }) => range.max));
  const exceedsSigned32 = min < 0 && (min < -(2 ** 31) || max > 2 ** 31 - 1);
  const exceedsUnsigned32 = min >= 0 && max > 2 ** 32 - 1;
  if (exceedsSigned32 || exceedsUnsigned32) return Float64Array;
  const type = getTypedArrayForDataRange(min, max);
  const wide = type === Int32Array || type === Uint32Array;
  return wide && float32KeepsIntegers({ min, max }) ? Float32Array : type;
}

/**
 * The element type a volume allocated from instances of these formats holds.
 *
 * An instance whose tags give no finite range is left out of the union and
 * judged on its decoded values by the containment guard instead.
 */
export function getVolumeBufferType(
  formats: PixelFormat[]
): VolumeBufferConstructor {
  const usable = formats.flatMap((format) => {
    const range = getRescaledValueRange(format);
    return range && Number.isFinite(range.min) && Number.isFinite(range.max)
      ? [{ format, range }]
      : [];
  });
  if (usable.length === 0)
    throw new Error('No instance declares a finite modality rescale range');

  // vtk.js uploads only 8/16-bit integer and float32 buffers without converting the whole volume.
  return usable.some(({ format }) => !isIntegralRescale(format))
    ? fractionalBufferType(usable)
    : integralBufferType(usable);
}

/** One format per frame, since enhanced instances calibrate frames separately. */
export const instancePixelFormats = (dataset: DicomDataset) =>
  Array.from(
    { length: numberOr(getDatasetTag(dataset, NumberOfFramesTag), 1) },
    (_, index) => getPixelFormat(dataset, index)
  );
