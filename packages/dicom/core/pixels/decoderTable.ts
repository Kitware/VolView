import type { Instance } from '../instance/readInstance';
import type { VolumeBufferConstructor } from '../volume/pixelFormat';
import { nativeFrameDecoder } from './nativeFrame';
import type { DecodeUnit, PixelDecoder } from './pixelDecoder';

/** Candidates per transfer syntax in preference order; the first that does not decline wins. */
export type DecoderTable = Readonly<{
  byTransferSyntax: ReadonlyMap<string, readonly PixelDecoder[]>;
  /** For transfer syntaxes the table does not list. */
  fallback: readonly PixelDecoder[];
  /** Names of known transfer syntaxes, so an error can say which one has no decoder. */
  names: ReadonlyMap<string, string>;
}>;

/** Every instance goes to `decoder`, whatever its transfer syntax. */
export const singleDecoderTable = (decoder: PixelDecoder): DecoderTable => ({
  byTransferSyntax: new Map(),
  fallback: [decoder],
  names: new Map(),
});

type Codec = 'native' | 'gdcm' | 'none';

// prettier-ignore
const SYNTAXES: Array<[string, string, Codec]> = [
  ['1.2.840.10008.1.2', 'Implicit VR Little Endian', 'native'],
  ['1.2.840.10008.1.2.1', 'Explicit VR Little Endian', 'native'],
  ['1.2.840.10008.1.2.2', 'Explicit VR Big Endian', 'native'],
  ['1.2.840.10008.1.2.1.99', 'Deflated Explicit VR Little Endian', 'gdcm'],
  ['1.2.840.10008.1.2.4.50', 'JPEG Baseline', 'gdcm'],
  ['1.2.840.10008.1.2.4.51', 'JPEG Extended', 'gdcm'],
  ['1.2.840.10008.1.2.4.57', 'JPEG Lossless', 'gdcm'],
  ['1.2.840.10008.1.2.4.70', 'JPEG Lossless, First-Order Prediction', 'gdcm'],
  ['1.2.840.10008.1.2.4.80', 'JPEG-LS Lossless', 'gdcm'],
  ['1.2.840.10008.1.2.4.81', 'JPEG-LS Near-Lossless', 'gdcm'],
  ['1.2.840.10008.1.2.4.90', 'JPEG 2000 Lossless', 'gdcm'],
  ['1.2.840.10008.1.2.4.91', 'JPEG 2000', 'gdcm'],
  ['1.2.840.10008.1.2.5', 'RLE Lossless', 'gdcm'],
  ['1.2.840.10008.1.2.4.94', 'JPIP Referenced', 'none'],
  ['1.2.840.10008.1.2.4.95', 'JPIP Referenced Deflate', 'none'],
  ['1.2.840.10008.1.2.4.100', 'MPEG2 Main Profile', 'none'],
  ['1.2.840.10008.1.2.4.101', 'MPEG2 High Profile', 'none'],
  ['1.2.840.10008.1.2.4.102', 'MPEG-4 AVC/H.264 High Profile', 'none'],
  ['1.2.840.10008.1.2.4.103', 'MPEG-4 AVC/H.264 BD-compatible High Profile', 'none'],
  ['1.2.840.10008.1.2.4.104', 'MPEG-4 AVC/H.264 High Profile For 2D Video', 'none'],
  ['1.2.840.10008.1.2.4.105', 'MPEG-4 AVC/H.264 High Profile For 3D Video', 'none'],
  ['1.2.840.10008.1.2.4.106', 'MPEG-4 AVC/H.264 Stereo High Profile', 'none'],
  ['1.2.840.10008.1.2.4.107', 'HEVC/H.265 Main Profile', 'none'],
  ['1.2.840.10008.1.2.4.108', 'HEVC/H.265 Main 10 Profile', 'none'],
  ['1.2.840.10008.1.2.4.110', 'JPEG XL Lossless', 'none'],
  ['1.2.840.10008.1.2.4.111', 'JPEG XL JPEG Recompression', 'none'],
  ['1.2.840.10008.1.2.4.112', 'JPEG XL', 'none'],
];

/** Native frames for uncompressed syntaxes, then GDCM for every syntax it may know. */
export function defaultDecoderTable(gdcm: PixelDecoder): DecoderTable {
  const candidates = {
    native: [nativeFrameDecoder, gdcm],
    gdcm: [gdcm],
    none: [],
  };
  return {
    byTransferSyntax: new Map(
      SYNTAXES.map(([uid, , codec]) => [uid, candidates[codec]])
    ),
    fallback: [gdcm],
    names: new Map(SYNTAXES.map(([uid, name]) => [uid, name])),
  };
}

function noDecoder(
  table: DecoderTable,
  syntax: string | null | undefined,
  declines: string[]
) {
  const name = syntax ? table.names.get(syntax) : undefined;
  const what = name
    ? `Known transfer syntax ${name} (${syntax})`
    : `Transfer syntax ${syntax ?? 'unknown'}`;
  const why = declines.length ? `: ${declines.join('; ')}` : '';
  return new Error(`${what} has no decoder${why}`);
}

type DecodePlan =
  | Readonly<{ decoder: PixelDecoder; units: DecodeUnit[] }>
  | Readonly<{ error: Error }>;

/** The units the first willing decoder loads `instance` in. Pure: reads only the header. */
export function planDecode(
  table: DecoderTable,
  instance: Instance,
  target: VolumeBufferConstructor
): DecodePlan {
  const syntax = instance.transferSyntaxUid;
  const candidates =
    (syntax && table.byTransferSyntax.get(syntax)) || table.fallback;
  const declines: string[] = [];
  for (const decoder of candidates) {
    const units = decoder.plan(instance, target);
    if (!('declined' in units)) return { decoder, units };
    declines.push(`${decoder.name} declined (${units.declined})`);
  }
  return { error: noDecoder(table, syntax, declines) };
}
