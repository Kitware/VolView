import type { DicomDataset } from '../metadata/dicomDataset';
import { getDatasetTag } from '../metadata/datasetAccess';
import { Tags } from '../metadata/dicomTags';
import { getFrameTag, perFrameGroups } from '../metadata/functionalGroups';
import { readModalityRescale } from '../metadata/modalityRescale';
import { frameCount } from '../pixels/pixelDecoder';
import { numberOr, trimDicomPadding } from '../utils';

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

export type ValueRange = { min: number; max: number };
export type Rescale = { rescaleSlope: number; rescaleIntercept: number };

// In the order a range is matched: unsigned before signed, narrow before wide.
const INTEGER_VALUE_RANGES = new Map<IntegerArrayConstructor, ValueRange>([
  [Uint8Array, { min: 0, max: 2 ** 8 - 1 }],
  [Uint16Array, { min: 0, max: 2 ** 16 - 1 }],
  [Uint32Array, { min: 0, max: 2 ** 32 - 1 }],
  [Int8Array, { min: -(2 ** 7), max: 2 ** 7 - 1 }],
  [Int16Array, { min: -(2 ** 15), max: 2 ** 15 - 1 }],
  [Int32Array, { min: -(2 ** 31), max: 2 ** 31 - 1 }],
]);

/**
 * The values `buffer` can hold without wrapping, or undefined if its element
 * type has no fixed integer range to enforce.
 */
export function getBufferValueRange(buffer: ArrayBufferView) {
  return INTEGER_VALUE_RANGES.get(
    buffer.constructor as IntegerArrayConstructor
  );
}

/**
 * Whether a decoded value range is representable in `buffer`'s element type.
 * A buffer with no enforceable range accepts everything.
 */
export function valuesFitBuffer(range: ValueRange, buffer: ArrayBufferView) {
  const bufferRange = getBufferValueRange(buffer);
  return (
    !bufferRange ||
    (range.min >= bufferRange.min && range.max <= bufferRange.max)
  );
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

/**
 * The sample depth of a palette color instance, which decodes to RGB: 8 bit
 * pixels take each entry's high byte, as GDCM takes it. Null for other
 * instances.
 */
export function paletteSampleBits(metadata: DicomDataset | null | undefined) {
  const photometric = getDatasetTag(metadata, Tags.PhotometricInterpretation);
  if (trimDicomPadding(photometric ?? '') !== 'PALETTE COLOR') return null;
  const descriptor = getDatasetTag(metadata, Tags.RedPaletteColorLUTDescriptor);
  const entryBits = Number(descriptor?.split('\\')[2]) === 8 ? 8 : 16;
  const bitsAllocated = numberOr(
    getDatasetTag(metadata, Tags.BitsAllocated),
    16
  );
  return Math.min(entryBits, bitsAllocated === 8 ? 8 : 16);
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
  const paletteBits = paletteSampleBits(metadata);
  if (paletteBits)
    return {
      bitsStored: paletteBits,
      pixelRepresentation: 0,
      rescaleSlope: 1,
      rescaleIntercept: 0,
    };
  // The Modality LUT module belongs to grayscale; color has no rescale.
  const color = numberOr(valueOf(Tags.SamplesPerPixel), 1) > 1;
  return {
    bitsStored: numberOr(valueOf(Tags.BitsStored), 0),
    pixelRepresentation: numberOr(valueOf(Tags.PixelRepresentation), 0),
    ...(color
      ? { rescaleSlope: 1, rescaleIntercept: 0 }
      : readModalityRescale(metadata, frameIndex)),
  };
}

type PixelFormat = ReturnType<typeof getPixelFormat>;

/**
 * The values an instance can decode to. Decoders apply RescaleSlope and
 * RescaleIntercept, so this is the range after rescaling.
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

const magnitude = ({ min, max }: ValueRange) =>
  Math.max(Math.abs(min), Math.abs(max));

const isIntegralRescale = (format: Rescale) =>
  Number.isInteger(format.rescaleSlope) &&
  Number.isInteger(format.rescaleIntercept);

/** Float32 holds every integer up to 2^24 exactly. */
const float32KeepsIntegers = (range: ValueRange) =>
  magnitude(range) <= FLOAT32_EXACT_INTEGER;

/** Float32's spacing near `range` stays below one stored step of `slope`. */
const float32KeepsSteps = (range: ValueRange, slope: number) =>
  slope !== 0 && magnitude(range) * FLOAT32_RELATIVE_STEP < Math.abs(slope);

/**
 * Whether a float32 buffer holds `range` as the rescale requires: integral
 * values exactly, fractional ones with adjacent stored steps kept apart.
 */
export const float32Holds = (range: ValueRange, format: Rescale) =>
  isIntegralRescale(format)
    ? float32KeepsIntegers(range)
    : float32KeepsSteps(range, format.rescaleSlope);

type UsableFormat = { format: PixelFormat; range: ValueRange };

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
  const min = Math.min(...usable.map(({ range }) => range.min));
  const max = Math.max(...usable.map(({ range }) => range.max));
  const fit = [...INTEGER_VALUE_RANGES].find(
    ([, held]) => min >= held.min && max <= held.max
  );
  const type = fit?.[0] ?? Float64Array;
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
    throw new Error(
      'No instance declares Bits Stored and a finite modality rescale range'
    );

  // vtk.js uploads only 8/16-bit integer and float32 buffers without converting the whole volume.
  return usable.some(({ format }) => !isIntegralRescale(format))
    ? fractionalBufferType(usable)
    : integralBufferType(usable);
}

/**
 * One format per frame, since enhanced instances calibrate frames separately.
 * Frames past the per-frame groups all read the shared or root tags, so one
 * format stands for them however many frames the header declares.
 */
export const instancePixelFormats = (dataset: DicomDataset) =>
  Array.from(
    {
      length: Math.min(frameCount(dataset), perFrameGroups(dataset).length + 1),
    },
    (_, index) => getPixelFormat(dataset, index)
  );
