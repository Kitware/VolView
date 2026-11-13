import type { Instance } from '../instance/readInstance';
import { indexFrames, type FrameIndex } from './frameIndex';
import {
  decodeNativeFrame,
  nativeCapability,
  type NativePixelFormat,
} from './nativeFrame';

/**
 * How one transfer syntax decodes: per frame without a codec, as a whole
 * instance by the runtime's decoder, or not at all.
 */
export type DecoderEntry =
  | Readonly<{
      kind: 'native';
      name: string;
      capability: typeof nativeCapability;
      decode: typeof decodeNativeFrame;
    }>
  | Readonly<{ kind: 'whole-instance'; name: string }>
  | Readonly<{ kind: 'unsupported'; name: string }>;

export type DecoderTable = Readonly<{
  byTransferSyntax: ReadonlyMap<string, DecoderEntry>;
  /** For transfer syntaxes the table does not list. */
  fallback: DecoderEntry;
}>;

const native = (name: string): DecoderEntry => ({
  kind: 'native',
  name,
  capability: nativeCapability,
  decode: decodeNativeFrame,
});
const wholeInstance = (name: string): DecoderEntry => ({
  kind: 'whole-instance',
  name,
});
const unsupported = (name: string): DecoderEntry => ({
  kind: 'unsupported',
  name,
});

// prettier-ignore
const ENTRIES: Array<[string, DecoderEntry]> = [
  ['1.2.840.10008.1.2', native('Implicit VR Little Endian')],
  ['1.2.840.10008.1.2.1', native('Explicit VR Little Endian')],
  ['1.2.840.10008.1.2.2', native('Explicit VR Big Endian')],
  ['1.2.840.10008.1.2.1.99', wholeInstance('Deflated Explicit VR Little Endian')],
  ['1.2.840.10008.1.2.4.50', wholeInstance('JPEG Baseline')],
  ['1.2.840.10008.1.2.4.51', wholeInstance('JPEG Extended')],
  ['1.2.840.10008.1.2.4.57', wholeInstance('JPEG Lossless')],
  ['1.2.840.10008.1.2.4.70', wholeInstance('JPEG Lossless, First-Order Prediction')],
  ['1.2.840.10008.1.2.4.80', wholeInstance('JPEG-LS Lossless')],
  ['1.2.840.10008.1.2.4.81', wholeInstance('JPEG-LS Near-Lossless')],
  ['1.2.840.10008.1.2.4.90', wholeInstance('JPEG 2000 Lossless')],
  ['1.2.840.10008.1.2.4.91', wholeInstance('JPEG 2000')],
  ['1.2.840.10008.1.2.5', wholeInstance('RLE Lossless')],
  ['1.2.840.10008.1.2.4.94', unsupported('JPIP Referenced')],
  ['1.2.840.10008.1.2.4.95', unsupported('JPIP Referenced Deflate')],
  ['1.2.840.10008.1.2.4.100', unsupported('MPEG2 Main Profile')],
  ['1.2.840.10008.1.2.4.101', unsupported('MPEG2 High Profile')],
  ['1.2.840.10008.1.2.4.102', unsupported('MPEG-4 AVC/H.264 High Profile')],
  ['1.2.840.10008.1.2.4.103', unsupported('MPEG-4 AVC/H.264 BD-compatible High Profile')],
  ['1.2.840.10008.1.2.4.104', unsupported('MPEG-4 AVC/H.264 High Profile For 2D Video')],
  ['1.2.840.10008.1.2.4.105', unsupported('MPEG-4 AVC/H.264 High Profile For 3D Video')],
  ['1.2.840.10008.1.2.4.106', unsupported('MPEG-4 AVC/H.264 Stereo High Profile')],
  ['1.2.840.10008.1.2.4.107', unsupported('HEVC/H.265 Main Profile')],
  ['1.2.840.10008.1.2.4.108', unsupported('HEVC/H.265 Main 10 Profile')],
  ['1.2.840.10008.1.2.4.110', unsupported('JPEG XL Lossless')],
  ['1.2.840.10008.1.2.4.111', unsupported('JPEG XL JPEG Recompression')],
  ['1.2.840.10008.1.2.4.112', unsupported('JPEG XL')],
];

/** Native syntaxes per frame; GDCM for every other syntax it may know. */
export const defaultDecoderTable: DecoderTable = {
  byTransferSyntax: new Map(ENTRIES),
  fallback: wholeInstance('Unlisted transfer syntax'),
};

/** Hands every instance to the runtime's whole-instance decoder. */
export const wholeInstanceDecoderTable: DecoderTable = {
  byTransferSyntax: new Map(),
  fallback: wholeInstance('Whole-instance decoder'),
};

type IndexedFrames = Extract<FrameIndex, { kind: 'indexed' }>;

export type DecodePlan =
  | Readonly<{
      kind: 'frames';
      index: IndexedFrames;
      format: NativePixelFormat;
      decode: typeof decodeNativeFrame;
    }>
  /** `reason` says why a native syntax still needs the whole instance. */
  | Readonly<{ kind: 'whole-instance'; reason?: string }>
  | Readonly<{ kind: 'unsupported'; error: Error }>;

/** How `instance` should decode under `table`. Pure: reads only the header. */
export function planDecode(
  table: DecoderTable,
  instance: Instance
): DecodePlan {
  const syntax = instance.transferSyntaxUid;
  const entry =
    (syntax && table.byTransferSyntax.get(syntax)) || table.fallback;
  if (entry.kind === 'unsupported')
    return {
      kind: 'unsupported',
      error: new Error(
        `Known transfer syntax ${entry.name} (${syntax}) has no decoder`
      ),
    };
  if (entry.kind === 'whole-instance') return { kind: 'whole-instance' };
  const index = indexFrames(instance);
  if (index.kind === 'unindexed')
    return { kind: 'whole-instance', reason: index.detail };
  const capability = entry.capability(instance, index.littleEndian);
  if (capability.kind === 'declined')
    return { kind: 'whole-instance', reason: capability.reason };
  return {
    kind: 'frames',
    index,
    format: capability.format,
    decode: entry.decode,
  };
}
