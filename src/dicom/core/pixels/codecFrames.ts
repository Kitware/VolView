import { splitEncapsulatedFrames } from './encapsulatedFrames';

export type FrameShape = Readonly<{
  columns: number;
  rows: number;
  components: number;
  bytesPerSample: number;
}>;

/** Every frame's samples back to back, interleaved by component, little endian. */
export type DecodedFrames = FrameShape & Readonly<{ bytes: Uint8Array }>;

/** One frame's codestream to its samples, which the caller owns. */
export type FrameCodec = (
  frame: Uint8Array
) => Readonly<{ shape: FrameShape; samples: Uint8Array }>;

export type CodecName = 'htj2k' | 'jpeg2000' | 'jpegLs' | 'rle';

export type CodecJob = Readonly<{
  codec: CodecName;
  /** The encapsulated Pixel Data value. */
  value: Uint8Array;
  frameCount: number;
  /** The header's frame shape, for codestreams that do not state their own. */
  shape: FrameShape;
}>;

const sameShape = (a: FrameShape, b: FrameShape) =>
  a.columns === b.columns &&
  a.rows === b.rows &&
  a.components === b.components &&
  a.bytesPerSample === b.bytesPerSample;

/** Decodes the frames of an encapsulated Pixel Data value. */
export function decodeEncapsulatedFrames(
  name: string,
  decodeFrame: FrameCodec,
  { value, frameCount }: Pick<CodecJob, 'value' | 'frameCount'>
): DecodedFrames {
  const frames = splitEncapsulatedFrames(value, frameCount).map(
    (frame, index) => {
      try {
        return decodeFrame(frame);
      } catch (error) {
        throw new Error(`${name} frame ${index + 1} did not decode`, {
          cause: error,
        });
      }
    }
  );
  const [{ shape, samples }] = frames;
  const mismatch = frames.findIndex((frame) => !sameShape(frame.shape, shape));
  if (mismatch >= 0)
    throw new Error(
      `${name} frame ${mismatch + 1} differs in size or depth from frame 1`
    );
  const bytes = new Uint8Array(samples.length * frames.length);
  frames.forEach((frame, index) =>
    bytes.set(frame.samples, index * samples.length)
  );
  return { bytes, ...shape };
}
