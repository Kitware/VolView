import type { Instance } from '../instance/readInstance';
import type { ByteRange } from '../source/byteSource';
import { getDatasetTag } from '../metadata/datasetAccess';
import {
  EXPLICIT_VR_LITTLE_ENDIAN,
  IMPLICIT_VR_LITTLE_ENDIAN,
} from '../metadata/dicomLayout';
import { numberOr } from '../utils';

export const EXPLICIT_VR_BIG_ENDIAN = '1.2.840.10008.1.2.2';
export const DEFLATED_EXPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2.1.99';

/** Transfer syntaxes whose Pixel Data is a plain run of fixed-size frames. */
export const NATIVE_ENCODINGS: ReadonlyMap<string, { littleEndian: boolean }> =
  new Map([
    [IMPLICIT_VR_LITTLE_ENDIAN, { littleEndian: true }],
    [EXPLICIT_VR_LITTLE_ENDIAN, { littleEndian: true }],
    [EXPLICIT_VR_BIG_ENDIAN, { littleEndian: false }],
  ]);

export type UnindexedReason =
  | 'no-pixel-data'
  | 'deflated'
  | 'encapsulated'
  | 'packed-bits'
  | 'invalid-shape'
  | 'truncated';

/**
 * Where each frame's bytes live. Only native encodings are indexed today; an
 * encapsulated index (offset tables, then a fragment scan) would add an
 * `encoding: 'encapsulated'` variant whose frames list fragment ranges.
 */
export type FrameIndex =
  | Readonly<{
      kind: 'indexed';
      encoding: 'native';
      littleEndian: boolean;
      frameLength: number;
      frames: readonly ByteRange[];
    }>
  | Readonly<{ kind: 'unindexed'; reason: UnindexedReason; detail: string }>;

const unindexed = (reason: UnindexedReason, detail: string): FrameIndex => ({
  kind: 'unindexed',
  reason,
  detail,
});

const shapeOf = (instance: Instance) => {
  const valueOf = (tag: string) =>
    numberOr(getDatasetTag(instance.dataset, tag), NaN);
  return {
    rows: valueOf('00280010'),
    columns: valueOf('00280011'),
    samplesPerPixel: numberOr(getDatasetTag(instance.dataset, '00280002'), 1),
    bitsAllocated: valueOf('00280100'),
    frames: numberOr(getDatasetTag(instance.dataset, '00280008'), 1),
  };
};

const positiveInteger = (value: number) =>
  Number.isSafeInteger(value) && value > 0;

// A file cut short after its header would otherwise fail once per frame.
const truncation = (
  needed: number,
  held: number,
  end: number,
  size: number | undefined
) => {
  if (needed > held)
    return `Pixel Data holds ${held} bytes; its frames need ${needed}`;
  return size !== undefined && end > size
    ? `The file holds ${size} bytes; its frames end at byte ${end}`
    : null;
};

/** Byte ranges of every frame, from the header alone. */
export function indexFrames(instance: Instance): FrameIndex {
  const { pixelData, transferSyntaxUid } = instance;
  if (!pixelData || !transferSyntaxUid)
    return unindexed('no-pixel-data', 'The header locates no Pixel Data');
  if (transferSyntaxUid === DEFLATED_EXPLICIT_VR_LITTLE_ENDIAN)
    return unindexed('deflated', 'The whole data set is deflated');
  const encoding = NATIVE_ENCODINGS.get(transferSyntaxUid);
  if (!encoding || pixelData.length === null)
    return unindexed(
      'encapsulated',
      `Transfer syntax ${transferSyntaxUid} is not indexable without a codec`
    );
  const { rows, columns, samplesPerPixel, bitsAllocated, frames } =
    shapeOf(instance);
  if (![rows, columns, samplesPerPixel, frames].every(positiveInteger))
    return unindexed(
      'invalid-shape',
      'Rows, Columns, Samples per Pixel or Number of Frames is unusable'
    );
  if (!positiveInteger(bitsAllocated) || bitsAllocated % 8 !== 0)
    return unindexed(
      'packed-bits',
      `Bits Allocated ${bitsAllocated} packs samples across bytes`
    );
  const frameLength = rows * columns * samplesPerPixel * (bitsAllocated / 8);
  const needed = frameLength * frames;
  const truncated = truncation(
    needed,
    pixelData.length,
    pixelData.valueOffset + needed,
    instance.source.size
  );
  if (truncated) return unindexed('truncated', truncated);
  return {
    kind: 'indexed',
    encoding: 'native',
    littleEndian: encoding.littleEndian,
    frameLength,
    frames: Array.from({ length: frames }, (_, frame) => {
      const start = pixelData.valueOffset + frame * frameLength;
      return { start, end: start + frameLength };
    }),
  };
}
