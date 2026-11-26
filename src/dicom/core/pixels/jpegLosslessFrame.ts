import { Decoder } from '@cornerstonejs/jpeg-lossless-decoder-js';
import type { FrameCodec, FrameShape } from './codecFrames';

/**
 * Lossless JPEG (process 14) at any precision, into samples as wide as the
 * header allocates rather than as the stream's precision alone implies.
 */
export const jpegLosslessFrameCodec =
  ({ bytesPerSample }: FrameShape): FrameCodec =>
  (frame) => {
    const decoder = new Decoder();
    const decoded = decoder.decode(
      frame.buffer as ArrayBuffer,
      frame.byteOffset,
      frame.length,
      bytesPerSample
    );
    const { dimX, dimY, numComp } = decoder.frame;
    return {
      shape: {
        columns: dimX,
        rows: dimY,
        components: numComp,
        bytesPerSample: decoded.BYTES_PER_ELEMENT,
      },
      samples: new Uint8Array(
        decoded.buffer,
        decoded.byteOffset,
        decoded.byteLength
      ),
    };
  };
