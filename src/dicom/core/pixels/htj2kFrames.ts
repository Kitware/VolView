import type { FrameInfo, OpenJphModule } from '@cornerstonejs/codec-openjph';
import { splitEncapsulatedFrames } from './encapsulatedFrames';

/** Every frame's samples back to back, interleaved by component, little endian. */
export type DecodedFrames = Readonly<{
  bytes: Uint8Array;
  columns: number;
  rows: number;
  components: number;
  bytesPerSample: number;
}>;

const shapeOf = (info: FrameInfo) => ({
  columns: info.width,
  rows: info.height,
  components: info.componentCount,
  bytesPerSample: info.bitsPerSample > 8 ? 2 : 1,
});

function decodeFrame(codec: OpenJphModule, frame: Uint8Array, index: number) {
  const decoder = new codec.HTJ2KDecoder();
  try {
    decoder.getEncodedBuffer(frame.length).set(frame);
    decoder.decode();
    return {
      shape: shapeOf(decoder.getFrameInfo()),
      samples: decoder.getDecodedBuffer().slice(),
    };
  } catch (error) {
    throw new Error(`HTJ2K frame ${index + 1} did not decode`, {
      cause: error,
    });
  } finally {
    decoder.delete();
  }
}

/** Decodes the frames of an encapsulated Pixel Data value. */
export function decodeHtj2kFrames(
  codec: OpenJphModule,
  value: Uint8Array,
  frameCount: number
): DecodedFrames {
  const frames = splitEncapsulatedFrames(value, frameCount).map(
    (frame, index) => decodeFrame(codec, frame, index)
  );
  const [{ shape }] = frames;
  const mismatch = frames.findIndex(
    (frame) => JSON.stringify(frame.shape) !== JSON.stringify(shape)
  );
  if (mismatch >= 0)
    throw new Error(
      `HTJ2K frame ${mismatch + 1} differs in size or depth from frame 1`
    );
  const frameLength = frames[0].samples.length;
  const bytes = new Uint8Array(frameLength * frames.length);
  frames.forEach(({ samples }, index) =>
    bytes.set(samples, index * frameLength)
  );
  return { bytes, ...shape };
}
