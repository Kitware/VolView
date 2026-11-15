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
import { numberOr } from '../utils';
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

/** Byte ranges of every frame, from the header alone. */
export function indexFrames(instance: Instance): FrameIndex {
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
  const { rows, columns, samplesPerPixel, bitsAllocated, frames } =
    shapeOf(instance);
  if (![rows, columns, samplesPerPixel, frames].every(positiveInteger))
    return unindexed(
      'Rows, Columns, Samples per Pixel or Number of Frames is unusable'
    );
  if (!positiveInteger(bitsAllocated) || bitsAllocated % 8 !== 0)
    return unindexed(
      `Bits Allocated ${bitsAllocated} packs samples across bytes`
    );
  const frameLength = rows * columns * samplesPerPixel * (bitsAllocated / 8);
  const needed = frameLength * frames;
  // Frames past the element's end would read whatever follows it.
  if (needed > pixelData.length)
    return unindexed(
      `Pixel Data holds ${pixelData.length} bytes; its frames need ${needed}`
    );
  return {
    kind: 'indexed',
    littleEndian: encoding.littleEndian,
    frameLength,
    frames: Array.from({ length: frames }, (_, frame) => {
      const start = pixelData.valueOffset + frame * frameLength;
      return { start, end: start + frameLength };
    }),
  };
}
