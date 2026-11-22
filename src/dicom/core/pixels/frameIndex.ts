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

// Chroma subsampling stores fewer bytes than Samples per Pixel implies.
const subsamplesChroma = ({ dataset }: Instance) =>
  /^YBR_(FULL|PARTIAL)_42[02]$/.test(
    trimDicomPadding(
      getDatasetTag(dataset, Tags.PhotometricInterpretation) ?? ''
    )
  );

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
  if (subsamplesChroma(instance))
    return unindexed('Chroma subsampled frames have no fixed sample layout');
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
    frameLength: rows * columns * samplesPerPixel * (bitsAllocated / 8),
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
