import type { Instance } from '../instance/readInstance';
import type { DicomDataset } from '../metadata/dicomDataset';
import { getDatasetTag } from '../metadata/datasetAccess';
import {
  hasUniformModalityRescale,
  readModalityRescale,
} from '../metadata/modalityRescale';
import { numberOr, trimDicomPadding } from '../utils';
import type { VolumeBufferConstructor } from '../volume/pixelFormat';
import { indexFrames } from './frameIndex';
import type { PixelDecoder } from './pixelDecoder';

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
  const { rescaleSlope, rescaleIntercept } = readModalityRescale(dataset);
  return {
    rows: number(dataset, '00280010'),
    columns: number(dataset, '00280011'),
    samplesPerPixel: numberOr(getDatasetTag(dataset, '00280002'), 1),
    photometricInterpretation: text(dataset, '00280004'),
    planar: number(dataset, '00280006') === 1,
    bitsAllocated: number(dataset, '00280100'),
    bitsStored: number(dataset, '00280101'),
    highBit: number(dataset, '00280102'),
    signed: number(dataset, '00280103') === 1,
    littleEndian,
    rescaleSlope,
    rescaleIntercept,
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
  const monochrome2 =
    samplesPerPixel === 1 && photometricInterpretation === 'MONOCHROME2';
  const rgb = samplesPerPixel === 3 && photometricInterpretation === 'RGB';
  return monochrome2 || rgb
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
  if (!Number.isFinite(slope) || !Number.isFinite(intercept))
    return 'Non-numeric modality rescale';
  const rgb = format.samplesPerPixel === 3;
  const plain = format.bitsAllocated === 8 && !format.signed;
  return rgb && !(plain && slope === 1 && intercept === 0)
    ? 'RGB samples that are not unsigned 8 bit and unscaled'
    : null;
};

// Each case was compared with GDCM in a browser: MONOCHROME1 comes back
// inverted, 8 bit words keep bits above Bits Stored, 32 bit words with fewer
// stored bits do not decode, and big endian words other than 16 bit are read
// as 16 bit pairs. Palette and YBR colour are not reproduced here.
const declineFormat = (format: NativePixelFormat) =>
  declinePhotometric(format) ??
  declineBits(format) ??
  declineByteOrder(format) ??
  declineRescale(format);

function declineDataset(dataset: DicomDataset) {
  if (!hasUniformModalityRescale(dataset))
    return 'Frames with differing modality rescale';
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
 * declined case keeps the whole-instance GDCM decode.
 */
export function nativeCapability(
  instance: Instance,
  littleEndian: boolean
): NativeCapability {
  const format = readNativePixelFormat(instance, littleEndian);
  const reason = declineFormat(format) ?? declineDataset(instance.dataset);
  return reason ? { kind: 'declined', reason } : { kind: 'native', format };
}

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
  const platformLittleEndian =
    new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  if (littleEndian === platformLittleEndian && bytes.byteOffset % size === 0)
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

/** Maps a stored word to its rescaled value. */
function storedValue(format: NativePixelFormat) {
  const { bitsStored, bitsAllocated, signed } = format;
  const { rescaleSlope: slope, rescaleIntercept: intercept } = format;
  // Bits Stored is below 32 when masking, so the bitwise result is nonnegative.
  const mask = bitsStored < bitsAllocated ? 2 ** bitsStored - 1 : -1;
  const signBit = signed ? 2 ** (bitsStored - 1) : Infinity;
  const wrap = 2 ** bitsStored;
  const stored = (word: number) => {
    const value = mask === -1 ? word : word & mask;
    return value >= signBit ? value - wrap : value;
  };
  return slope === 1 && intercept === 0
    ? stored
    : (word: number) => stored(word) * slope + intercept;
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
  const pixels = rows * columns;
  const count = pixels * components;
  const frameLength = count * (format.bitsAllocated / 8);
  if (bytes.length < frameLength)
    throw new Error(
      `A frame needs ${frameLength} bytes of Pixel Data; ${bytes.length} were read`
    );
  const words = storedWords(bytes, format, count);
  const valueOf = storedValue(format);
  const samples = new Target(count);
  const min = new Array<number>(components).fill(Infinity);
  const max = new Array<number>(components).fill(-Infinity);
  for (let component = 0; component < components; component += 1) {
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      const source = planar
        ? component * pixels + pixel
        : pixel * components + component;
      const value = valueOf(words[source]);
      samples[pixel * components + component] = value;
      if (value < min[component]) min[component] = value;
      if (value > max[component]) max[component] = value;
    }
  }
  return {
    samples,
    range: min.map(
      (low, component) => [low, max[component]] as [number, number]
    ),
  };
}

/** Decodes each frame of an instance it reproduces exactly from its own ranged read. */
export const nativeFrameDecoder: PixelDecoder = {
  name: 'Native frames',
  plan: (instance, Target) => {
    const index = indexFrames(instance);
    if (index.kind === 'unindexed') return { declined: index.detail };
    const capability = nativeCapability(instance, index.littleEndian);
    if (capability.kind === 'declined') return { declined: capability.reason };
    const { format } = capability;
    return index.frames.map((range, frame) => ({
      firstFrame: frame,
      frames: 1,
      range,
      decode: (bytes) => {
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
