import type { Instance } from '../instance/readInstance';
import type { DicomDataset } from '../metadata/dicomDataset';
import { getDatasetTag } from '../metadata/datasetAccess';
import { Tags } from '../metadata/dicomTags';
import { readModalityRescale } from '../metadata/modalityRescale';
import { numberOr, trimDicomPadding } from '../utils';
import type { VolumeBufferConstructor } from '../volume/pixelFormat';
import { indexFrames, shapeOf } from './frameIndex';
import type { DecodedPixels, PixelDecoder } from './pixelDecoder';

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
  highBit: number;
  signed: boolean;
  littleEndian: boolean;
  /** The first frame's; `frameFormats` gives each frame its own. */
  rescaleSlope: number;
  rescaleIntercept: number;
}>;

type NativeCapability =
  | Readonly<{ kind: 'native'; format: NativePixelFormat }>
  | Readonly<{ kind: 'declined'; reason: string }>;

const text = (dataset: DicomDataset, tag: string) =>
  trimDicomPadding(getDatasetTag(dataset, tag) ?? '');

const number = (dataset: DicomDataset, tag: string) =>
  numberOr(getDatasetTag(dataset, tag), NaN);

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
    photometricInterpretation: text(dataset, Tags.PhotometricInterpretation),
    planar: number(dataset, Tags.PlanarConfiguration) === 1,
    bitsAllocated,
    bitsStored: number(dataset, Tags.BitsStored),
    highBit: number(dataset, '00280102'),
    signed: number(dataset, Tags.PixelRepresentation) === 1,
    littleEndian,
    ...readModalityRescale(dataset),
  };
}

const isOverlayOrCurve = (group: number) =>
  (group >= 0x5000 && group <= 0x501e) || (group >= 0x6000 && group <= 0x601e);

/** Header elements whose effect on GDCM's output is not reproduced here. */
const UNREPRODUCED_ELEMENTS = new Map([
  ['00283000', 'Modality LUT Sequence'],
  ['00281101', 'Red Palette Color Lookup Table Descriptor'],
  ['00282000', 'ICC Profile'],
]);

const declinePhotometric = (format: NativePixelFormat) => {
  const { samplesPerPixel, photometricInterpretation } = format;
  const monochrome =
    samplesPerPixel === 1 &&
    ['MONOCHROME1', 'MONOCHROME2'].includes(photometricInterpretation);
  const rgb = samplesPerPixel === 3 && photometricInterpretation === 'RGB';
  return monochrome || rgb
    ? null
    : `${photometricInterpretation || 'Unknown'} photometric interpretation with ${samplesPerPixel} samples per pixel`;
};

const declineBits = ({
  bitsAllocated,
  bitsStored,
  highBit,
}: NativePixelFormat) => {
  if (![8, 16, 32].includes(bitsAllocated))
    return `Bits Allocated ${bitsAllocated}`;
  const valid =
    Number.isInteger(bitsStored) &&
    bitsStored >= 1 &&
    bitsStored <= bitsAllocated &&
    highBit === bitsStored - 1;
  if (!valid) return `Bits Stored ${bitsStored} with High Bit ${highBit}`;
  return bitsAllocated !== 16 && bitsStored < bitsAllocated
    ? `${bitsStored} of ${bitsAllocated} allocated bits stored`
    : null;
};

const declineByteOrder = ({
  littleEndian,
  bitsAllocated,
}: NativePixelFormat) =>
  littleEndian || bitsAllocated === 16
    ? null
    : `Big endian ${bitsAllocated} bit samples`;

const declineRescale = (format: NativePixelFormat) => {
  const { rescaleSlope: slope, rescaleIntercept: intercept } = format;
  const rgb = format.samplesPerPixel === 3;
  const plain = format.bitsAllocated === 8 && !format.signed;
  return rgb && !(plain && slope === 1 && intercept === 0)
    ? 'RGB samples that are not unsigned 8 bit and unscaled'
    : null;
};

// Each case was compared with GDCM in a browser: 8 bit words keep bits above
// Bits Stored, 32 bit words with fewer stored bits do not decode, and big
// endian words other than 16 bit are read as 16 bit pairs. Palette and YBR
// colour are not reproduced here.
const declineFormat = (format: NativePixelFormat) =>
  declinePhotometric(format) ??
  declineBits(format) ??
  declineByteOrder(format) ??
  declineRescale(format);

function declineDataset(dataset: DicomDataset) {
  const element = dataset.elements.find(
    ({ tag, group }) =>
      UNREPRODUCED_ELEMENTS.has(tag) || isOverlayOrCurve(group)
  );
  if (element)
    return isOverlayOrCurve(element.group)
      ? 'Overlay or curve data, which may share the pixel words'
      : UNREPRODUCED_ELEMENTS.get(element.tag)!;
  return null;
}

/**
 * Whether GDCM's output for this instance is reproduced exactly here. Every
 * declined case keeps the whole-instance GDCM decode. Frames that differ in
 * modality rescale are the exception: GDCM gives an instance one transform,
 * and each frame gets its own here. `decodedAs` gives the format of the
 * samples a codec hands back where it differs from the header's.
 */
export function nativeCapability(
  instance: Instance,
  littleEndian: boolean,
  decodedAs = (format: NativePixelFormat) => format
): NativeCapability {
  const format = decodedAs(readNativePixelFormat(instance, littleEndian));
  const reason = declineFormat(format) ?? declineDataset(instance.dataset);
  return reason ? { kind: 'declined', reason } : { kind: 'native', format };
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
 * Decodes one native frame into interleaved, modality-rescaled samples of the
 * given element type. `range` is each component's [min, max] before the
 * values are stored, so a caller can reject values `Target` cannot hold.
 */
export function decodeNativeFrame(
  bytes: Uint8Array,
  format: NativePixelFormat,
  Target: VolumeBufferConstructor
) {
  const { rows, columns, samplesPerPixel: components, planar } = format;
  const { bitsStored, bitsAllocated, signed } = format;
  const { rescaleSlope: slope, rescaleIntercept: intercept } = format;
  const pixels = rows * columns;
  const count = pixels * components;
  const frameLength = count * (bitsAllocated / 8);
  if (bytes.length < frameLength)
    throw new Error(
      `A frame needs ${frameLength} bytes of Pixel Data; ${bytes.length} were read`
    );
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
  return { samples, range };
}

/** Decodes back-to-back native frames, one per format, into one run of samples. */
export function decodeNativeFrames(
  bytes: Uint8Array,
  formats: readonly NativePixelFormat[],
  Target: VolumeBufferConstructor
): DecodedPixels {
  const { columns, rows, samplesPerPixel: components } = formats[0];
  const count = columns * rows * components;
  const frameLength = count * (formats[0].bitsAllocated / 8);
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

/** Decodes each frame of an instance it reproduces exactly from its own ranged read. */
export const nativeFrameDecoder: PixelDecoder = {
  name: 'Native frames',
  plan: (instance, Target) => {
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
        const { samples, range: values } = decodeNativeFrame(
          bytes,
          format,
          Target
        );
        return {
          data: samples,
          size: [format.columns, format.rows, 1],
          components: format.samplesPerPixel,
          range: values,
        };
      },
    }));
  },
};
