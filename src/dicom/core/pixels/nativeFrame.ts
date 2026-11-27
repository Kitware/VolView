import type { Instance } from '../instance/readInstance';
import { EXPLICIT_VR_BIG_ENDIAN } from '../metadata/dicomLayout';
import type { DicomDataset } from '../metadata/dicomDataset';
import { getDatasetTag } from '../metadata/datasetAccess';
import { Tags } from '../metadata/dicomTags';
import { readModalityRescale } from '../metadata/modalityRescale';
import { numberOr } from '../utils';
import type { VolumeBufferConstructor } from '../volume/pixelFormat';
import { planesAsInterleaved, ybr422AsYbrFull, ybrFullAsRgb } from './color';
import {
  frameByteLength,
  indexFrames,
  ONE_SAMPLE_PHOTOMETRICS,
  shapeOf,
  storedPhotometric,
} from './frameIndex';
import { paletteAsRgb, readPalette, type Palette } from './palette';
import {
  frameCount,
  type DecodedPixels,
  type PixelDecoder,
} from './pixelDecoder';

/** What decides how one native frame's bytes become samples. */
export type NativePixelFormat = Readonly<{
  rows: number;
  columns: number;
  samplesPerPixel: number;
  photometricInterpretation: string;
  /** Color planes stored one after another rather than interleaved. */
  planar: boolean;
  bitsAllocated: number;
  bitsStored: number;
  signed: boolean;
  littleEndian: boolean;
  /** 8 bit samples held in 16 bit words, which a big endian file swaps. */
  swappedPairs?: boolean;
  /** The first frame's; `frameFormats` gives each frame its own. */
  rescaleSlope: number;
  rescaleIntercept: number;
  /** The lookup that gives PALETTE COLOR values their color. */
  palette?: Palette;
}>;

type NativeCapability =
  | Readonly<{ kind: 'native'; format: NativePixelFormat }>
  | Readonly<{ kind: 'declined'; reason: string }>;

const number = (dataset: DicomDataset, tag: string) =>
  numberOr(getDatasetTag(dataset, tag), NaN);

const COLOR_AS_RGB = ['RGB', 'YBR_FULL', 'YBR_FULL_422'];

/** The header's pixel description, read without judging it. */
function readNativePixelFormat(
  instance: Instance,
  littleEndian: boolean
): NativePixelFormat {
  const { dataset } = instance;
  const { rows, columns, samplesPerPixel, bitsAllocated } = shapeOf(instance);
  return {
    rows,
    columns,
    samplesPerPixel,
    photometricInterpretation: storedPhotometric(instance),
    planar: number(dataset, Tags.PlanarConfiguration) === 1,
    bitsAllocated,
    bitsStored: number(dataset, Tags.BitsStored),
    signed: number(dataset, Tags.PixelRepresentation) === 1,
    littleEndian,
    swappedPairs:
      !littleEndian && bitsAllocated === 8 && instance.pixelData?.vr === 'OW',
    ...readModalityRescale(dataset),
  };
}

const declinePhotometric = (format: NativePixelFormat) => {
  const { samplesPerPixel, photometricInterpretation, bitsAllocated } = format;
  const accepted =
    samplesPerPixel === 1
      ? ONE_SAMPLE_PHOTOMETRICS.includes(photometricInterpretation)
      : samplesPerPixel === 3 &&
        COLOR_AS_RGB.includes(photometricInterpretation);
  if (!accepted)
    return `${photometricInterpretation || 'Unknown'} photometric interpretation with ${samplesPerPixel} samples per pixel`;
  return photometricInterpretation.startsWith('YBR') && bitsAllocated !== 8
    ? `${photometricInterpretation} samples of ${bitsAllocated} bits`
    : null;
};

const declineBits = ({ bitsAllocated, bitsStored }: NativePixelFormat) => {
  if (![1, 8, 12, 16, 32].includes(bitsAllocated))
    return `Bits Allocated ${bitsAllocated}`;
  const valid =
    Number.isInteger(bitsStored) &&
    bitsStored >= 1 &&
    bitsStored <= bitsAllocated;
  return valid ? null : `Bits Stored ${bitsStored}`;
};

const declineFormat = (format: NativePixelFormat) =>
  declinePhotometric(format) ?? declineBits(format);

/**
 * Whether these samples can be decoded here. `decodedAs` gives the format of
 * the samples a codec hands back where it differs from the header's.
 */
export function nativeCapability(
  instance: Instance,
  littleEndian: boolean,
  decodedAs = (format: NativePixelFormat) => format
): NativeCapability {
  const format = decodedAs(readNativePixelFormat(instance, littleEndian));
  const reason = declineFormat(format);
  if (reason) return { kind: 'declined', reason };
  if (format.photometricInterpretation !== 'PALETTE COLOR')
    return { kind: 'native', format };
  const palette = readPalette(instance.dataset, littleEndian);
  return 'missing' in palette
    ? { kind: 'declined', reason: palette.missing }
    : { kind: 'native', format: { ...format, palette } };
}

/** `format` for each frame, with the modality rescale that frame declares. */
export const frameFormats = (
  format: NativePixelFormat,
  dataset: DicomDataset,
  frames: number
) =>
  Array.from({ length: frames }, (_, frame) => ({
    ...format,
    ...readModalityRescale(dataset, frame),
  }));

const PLATFORM_LITTLE_ENDIAN =
  new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** Stored words as unsigned integers, viewed in place where alignment allows. */
function storedWords(
  bytes: Uint8Array,
  format: NativePixelFormat,
  count: number
) {
  const { bitsAllocated, littleEndian } = format;
  if (bitsAllocated === 8) return bytes.subarray(0, count);
  const size = bitsAllocated / 8;
  const Words = bitsAllocated === 16 ? Uint16Array : Uint32Array;
  if (littleEndian === PLATFORM_LITTLE_ENDIAN && bytes.byteOffset % size === 0)
    return new Words(bytes.buffer as ArrayBuffer, bytes.byteOffset, count);
  const view = new DataView(bytes.buffer, bytes.byteOffset, count * size);
  const words = new Words(count);
  for (let index = 0; index < count; index += 1)
    words[index] =
      size === 2
        ? view.getUint16(index * 2, littleEndian)
        : view.getUint32(index * 4, littleEndian);
  return words;
}

/**
 * Samples of a grayscale or interleaved RGB frame: masked to Bits Stored,
 * sign extended and, for grayscale, rescaled. `range` is each component's
 * [min, max] before the values are stored in `Target`.
 */
function plainSamples(
  bytes: Uint8Array,
  format: NativePixelFormat,
  Target: VolumeBufferConstructor
) {
  const { rows, columns, samplesPerPixel: components, planar } = format;
  const { bitsAllocated, signed } = format;
  // A byte keeps the bits above Bits Stored, as GDCM kept them, so files that
  // understate Bits Stored still load whole.
  const bitsStored = bitsAllocated === 8 ? 8 : format.bitsStored;
  // The Modality LUT module belongs to grayscale; color has no rescale.
  const [slope, intercept] =
    components === 1 ? [format.rescaleSlope, format.rescaleIntercept] : [1, 0];
  const pixels = rows * columns;
  const count = pixels * components;
  const words = storedWords(bytes, format, count);
  const samples = new Target(count);
  const mask = bitsStored < bitsAllocated ? 2 ** bitsStored - 1 : 0xffffffff;
  const signBit = signed ? 2 ** (bitsStored - 1) : Infinity;
  const wrap = 2 ** bitsStored;
  const range = Array.from({ length: components }, (_, component) => {
    const first = planar ? component * pixels : component;
    const stride = planar ? 1 : components;
    let low = Infinity;
    let high = -Infinity;
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      // The unsigned shift undoes the sign a full 32 bit mask leaves.
      const word = (words[first + pixel * stride] & mask) >>> 0;
      const value = (word >= signBit ? word - wrap : word) * slope + intercept;
      samples[pixel * components + component] = value;
      if (value < low) low = value;
      if (value > high) high = value;
    }
    return [low, high] as [number, number];
  });
  return { samples, range, components };
}

const asRgb = (format: NativePixelFormat): NativePixelFormat => ({
  ...format,
  photometricInterpretation: 'RGB',
  samplesPerPixel: 3,
  planar: false,
  palette: undefined,
});

/** A PALETTE COLOR frame's stored values, before any lookup. */
const paletteIndexes = (bytes: Uint8Array, format: NativePixelFormat) =>
  plainSamples(
    bytes,
    { ...format, palette: undefined, rescaleSlope: 1, rescaleIntercept: 0 },
    Int32Array
  ).samples;

/**
 * A frame as grayscale or interleaved RGB samples: YBR color converted, and
 * palette values looked up. Any other frame is returned as it is.
 */
function asPlainFrame(bytes: Uint8Array, format: NativePixelFormat) {
  const { rows, columns, planar, palette } = format;
  const pixels = rows * columns;
  if (format.photometricInterpretation === 'YBR_FULL_422')
    return {
      bytes: ybrFullAsRgb(ybr422AsYbrFull(bytes, pixels)),
      format: asRgb(format),
    };
  if (format.photometricInterpretation === 'YBR_FULL') {
    const stored = bytes.subarray(0, pixels * 3);
    return {
      bytes: ybrFullAsRgb(
        planar ? planesAsInterleaved(stored, pixels) : stored
      ),
      format: asRgb(format),
    };
  }
  if (palette) {
    const rgb = paletteAsRgb(paletteIndexes(bytes, format), palette);
    return {
      bytes: new Uint8Array(rgb.buffer),
      format: {
        ...asRgb(format),
        bitsAllocated: palette.bits,
        bitsStored: palette.bits,
        signed: false,
        littleEndian: PLATFORM_LITTLE_ENDIAN,
      },
    };
  }
  return { bytes, format };
}

/** Samples per pixel a frame of this format decodes to. */
const decodedComponents = (format: NativePixelFormat) =>
  format.palette ? 3 : format.samplesPerPixel;

/** Each pair of bytes exchanged, as 16 bit words change byte order. */
const swapPairs = (bytes: Uint8Array) =>
  Uint8Array.from(bytes, (_, index) => bytes[index ^ 1] ?? 0);

/**
 * Decodes one native frame into interleaved samples of the given element
 * type: grayscale with its modality rescale applied, or RGB. `range` is each
 * component's [min, max] before the values are stored, so a caller can reject
 * values `Target` cannot hold.
 */
export function decodeNativeFrame(
  bytes: Uint8Array,
  stored: NativePixelFormat,
  Target: VolumeBufferConstructor
) {
  const frameLength = frameByteLength(stored);
  if (bytes.length < frameLength)
    throw new Error(
      `A frame needs ${frameLength} bytes of Pixel Data; ${bytes.length} were read`
    );
  const plain = stored.swappedPairs
    ? asPlainFrame(swapPairs(bytes), { ...stored, swappedPairs: false })
    : asPlainFrame(bytes, stored);
  return plainSamples(plain.bytes, plain.format, Target);
}

/**
 * Samples packed end to end with no padding, lowest bit first, as whole
 * little endian words. Frames of such samples share bytes at their boundaries.
 */
function unpackSamples(bytes: Uint8Array, count: number, bits: number) {
  if (bytes.length * 8 < count * bits)
    throw new Error(
      `Pixel Data holds ${bytes.length * 8} bits; its frames need ${count * bits}`
    );
  const words = bits <= 8 ? new Uint8Array(count) : new Uint16Array(count);
  for (let index = 0; index < count; index += 1) {
    let word = 0;
    for (let bit = 0; bit < bits; bit += 1) {
      const at = index * bits + bit;
      word |= ((bytes[at >> 3] >> (at & 7)) & 1) << bit;
    }
    words[index] = word;
  }
  return new Uint8Array(words.buffer);
}

const isPacked = (bitsAllocated: number) => bitsAllocated % 8 !== 0;

/**
 * Decodes back-to-back native frames, one per format, into one run of
 * samples.
 */
export function decodeNativeFrames(
  bytes: Uint8Array,
  formats: readonly NativePixelFormat[],
  Target: VolumeBufferConstructor
): DecodedPixels {
  const { columns, rows, bitsAllocated, samplesPerPixel } = formats[0];
  if (isPacked(bitsAllocated)) {
    const samples = columns * rows * samplesPerPixel * formats.length;
    const whole = Math.ceil(bitsAllocated / 8) * 8;
    return decodeNativeFrames(
      unpackSamples(bytes, samples, bitsAllocated),
      formats.map((format) => ({
        ...format,
        bitsAllocated: whole,
        littleEndian: PLATFORM_LITTLE_ENDIAN,
      })),
      Target
    );
  }
  // The words pair bytes from the start of Pixel Data, not of each frame.
  if (formats[0].swappedPairs)
    return decodeNativeFrames(
      swapPairs(bytes),
      formats.map((format) => ({ ...format, swappedPairs: false })),
      Target
    );
  const components = decodedComponents(formats[0]);
  const count = columns * rows * components;
  const frameLength = frameByteLength(formats[0]);
  const data = new Target(count * formats.length);
  const ranges = formats.map((format, frame) => {
    const { samples, range } = decodeNativeFrame(
      bytes.subarray(frame * frameLength),
      format,
      Target
    );
    data.set(samples, frame * count);
    return range;
  });
  const range = Array.from({ length: components }, (_, component) => {
    const each = ranges.map((frameRange) => frameRange[component]);
    return [
      Math.min(...each.map(([low]) => low)),
      Math.max(...each.map(([, high]) => high)),
    ] as const;
  });
  return { data, size: [columns, rows, formats.length], components, range };
}

/**
 * The one unit that reads every frame of an instance whose frames share
 * bytes or 16 bit words at their boundaries: samples packed across bytes, and
 * big endian byte pairs in frames of odd length. Undefined for any other.
 */
function sharedBytesUnit(instance: Instance, Target: VolumeBufferConstructor) {
  const { pixelData, dataset, transferSyntaxUid } = instance;
  if (!pixelData?.length) return undefined;
  const capability = nativeCapability(
    instance,
    transferSyntaxUid !== EXPLICIT_VR_BIG_ENDIAN
  );
  const packed = isPacked(shapeOf(instance).bitsAllocated);
  if (capability.kind === 'declined')
    return packed ? { declined: capability.reason } : undefined;
  const { format } = capability;
  const oddPairs = format.swappedPairs && frameByteLength(format) % 2 === 1;
  if (!packed && !oddPairs) return undefined;
  if (packed && !format.littleEndian)
    return { declined: 'Big endian samples packed across bytes' };
  const frames = frameCount(dataset);
  const formats = frameFormats(format, dataset, frames);
  const start = pixelData.valueOffset;
  return [
    {
      firstFrame: 0,
      frames,
      range: { start, end: start + pixelData.length },
      decode: (bytes: Uint8Array) => decodeNativeFrames(bytes, formats, Target),
    },
  ];
}

/** Decodes each frame of an uncompressed instance from its own ranged read. */
export const nativeFrameDecoder: PixelDecoder = {
  name: 'Native frames',
  plan: (instance, Target) => {
    const shared = sharedBytesUnit(instance, Target);
    if (shared) return shared;
    const index = indexFrames(instance);
    if (index.kind === 'unindexed') return { declined: index.detail };
    const capability = nativeCapability(instance, index.littleEndian);
    if (capability.kind === 'declined') return { declined: capability.reason };
    const formats = frameFormats(
      capability.format,
      instance.dataset,
      index.frames.length
    );
    return index.frames.map((range, frame) => ({
      firstFrame: frame,
      frames: 1,
      range,
      decode: (bytes) => {
        const format = formats[frame];
        const decoded = decodeNativeFrame(bytes, format, Target);
        return {
          data: decoded.samples,
          size: [format.columns, format.rows, 1],
          components: decoded.components,
          range: decoded.range,
        };
      },
    }));
  },
};
