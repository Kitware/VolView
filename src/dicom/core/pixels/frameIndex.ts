import type { Instance } from '../instance/readInstance';
import type { ByteRange } from '../source/byteSource';
import { getDatasetTag } from '../metadata/datasetAccess';
import {
  DEFLATED_EXPLICIT_VR_LITTLE_ENDIAN,
  EXPLICIT_VR_BIG_ENDIAN,
  EXPLICIT_VR_LITTLE_ENDIAN,
  IMPLICIT_VR_LITTLE_ENDIAN,
} from '../metadata/dicomLayout';
import { Tags } from '../metadata/dicomTags';
import { numberOr, trimDicomPadding } from '../utils';
import { frameCount } from './pixelDecoder';

/** Transfer syntaxes whose Pixel Data is a plain run of fixed-size frames. */
const NATIVE_ENCODINGS: ReadonlyMap<string, { littleEndian: boolean }> =
  new Map([
    [IMPLICIT_VR_LITTLE_ENDIAN, { littleEndian: true }],
    [EXPLICIT_VR_LITTLE_ENDIAN, { littleEndian: true }],
    [EXPLICIT_VR_BIG_ENDIAN, { littleEndian: false }],
  ]);

/** Where each frame's bytes live, for native encodings. */
type FrameIndex =
  | Readonly<{
      kind: 'indexed';
      littleEndian: boolean;
      frameLength: number;
      frames: readonly ByteRange[];
    }>
  | Readonly<{ kind: 'unindexed'; detail: string }>;

const unindexed = (detail: string): FrameIndex => ({
  kind: 'unindexed',
  detail,
});

/** The header's frame shape, NaN where a required value is unreadable. */
export const shapeOf = ({ dataset }: Instance) => {
  const valueOf = (tag: string) => numberOr(getDatasetTag(dataset, tag), NaN);
  return {
    rows: valueOf(Tags.Rows),
    columns: valueOf(Tags.Columns),
    samplesPerPixel: numberOr(getDatasetTag(dataset, Tags.SamplesPerPixel), 1),
    bitsAllocated: valueOf(Tags.BitsAllocated),
    frames: frameCount(dataset),
  };
};

const positiveInteger = (value: number) =>
  Number.isSafeInteger(value) && value > 0;

/** Bytes one uncompressed frame of this shape takes. */
export const frameByteLength = (shape: {
  rows: number;
  columns: number;
  samplesPerPixel: number;
  bitsAllocated: number;
  photometricInterpretation: string;
}) =>
  // Two pixels share one Cb and one Cr sample: four bytes for six samples.
  shape.photometricInterpretation === 'YBR_FULL_422'
    ? shape.rows * shape.columns * 2
    : shape.rows *
      shape.columns *
      shape.samplesPerPixel *
      (shape.bitsAllocated / 8);

export const ONE_SAMPLE_PHOTOMETRICS = [
  'MONOCHROME1',
  'MONOCHROME2',
  'PALETTE COLOR',
];

/**
 * The photometric interpretation the stored samples follow. One sample per
 * pixel with no palette can only be shades of gray, which is what ACR-NEMA
 * files and misspelled values mean. Uncompressed YBR_FULL_422 that holds
 * three bytes a pixel kept the label of the JPEG it was decompressed from.
 */
export function storedPhotometric(instance: Instance) {
  const { dataset, pixelData, transferSyntaxUid } = instance;
  const declared = trimDicomPadding(
    getDatasetTag(dataset, Tags.PhotometricInterpretation) ?? ''
  );
  const { rows, columns, samplesPerPixel, frames } = shapeOf(instance);
  if (samplesPerPixel === 1)
    return ONE_SAMPLE_PHOTOMETRICS.includes(declared)
      ? declared
      : 'MONOCHROME2';
  const fullySampled =
    declared === 'YBR_FULL_422' &&
    NATIVE_ENCODINGS.has(transferSyntaxUid ?? '') &&
    (pixelData?.length ?? 0) >= rows * columns * 3 * frames;
  return fullySampled ? 'YBR_FULL' : declared;
}

type NativeLayout = Readonly<{
  kind: 'native';
  littleEndian: boolean;
  frameLength: number;
  frames: number;
  valueOffset: number;
  length: number;
}>;

function nativeLayout(instance: Instance): NativeLayout | FrameIndex {
  const { pixelData, transferSyntaxUid } = instance;
  if (!pixelData || !transferSyntaxUid)
    return unindexed('The header locates no Pixel Data');
  if (transferSyntaxUid === DEFLATED_EXPLICIT_VR_LITTLE_ENDIAN)
    return unindexed('The whole data set is deflated');
  const encoding = NATIVE_ENCODINGS.get(transferSyntaxUid);
  if (!encoding)
    return unindexed(
      `Transfer syntax ${transferSyntaxUid} is not indexable without a codec`
    );
  if (pixelData.length === null)
    return unindexed('Pixel Data has undefined length');
  const photometricInterpretation = storedPhotometric(instance);
  if (/^YBR_(FULL_420|PARTIAL_42[02])$/.test(photometricInterpretation))
    return unindexed(
      `${photometricInterpretation} frames have no supported sample layout`
    );
  const { rows, columns, samplesPerPixel, bitsAllocated, frames } =
    shapeOf(instance);
  if (![rows, columns, samplesPerPixel].every(positiveInteger))
    return unindexed('Rows, Columns or Samples per Pixel is unusable');
  if (!positiveInteger(bitsAllocated) || bitsAllocated % 8 !== 0)
    return unindexed(
      `Bits Allocated ${bitsAllocated} packs samples across bytes`
    );
  return {
    kind: 'native',
    littleEndian: encoding.littleEndian,
    frameLength: frameByteLength({
      rows,
      columns,
      samplesPerPixel,
      bitsAllocated,
      photometricInterpretation,
    }),
    frames,
    valueOffset: pixelData.valueOffset,
    length: pixelData.length,
  };
}

const overrun = ({ frameLength, frames, length }: NativeLayout) => {
  const needed = frameLength * frames;
  return needed > length
    ? `Pixel Data holds ${length} bytes; its frames need ${needed}`
    : null;
};

/** Why a native instance's Pixel Data is too short for its declared frames, or null. */
export function nativeFramesOverrun(instance: Instance) {
  const layout = nativeLayout(instance);
  return layout.kind === 'native' ? overrun(layout) : null;
}

/** Byte ranges of every frame, from the header alone. */
export function indexFrames(instance: Instance): FrameIndex {
  const layout = nativeLayout(instance);
  if (layout.kind !== 'native') return layout;
  // Frames past the element's end would read whatever follows it.
  const detail = overrun(layout);
  if (detail) return unindexed(detail);
  const { littleEndian, frameLength, frames, valueOffset } = layout;
  return {
    kind: 'indexed',
    littleEndian,
    frameLength,
    frames: Array.from({ length: frames }, (_, frame) => {
      const start = valueOffset + frame * frameLength;
      return { start, end: start + frameLength };
    }),
  };
}
