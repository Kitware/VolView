import type { OpenJphModule } from '@cornerstonejs/codec-openjph';
import type { FrameCodec } from './codecFrames';

export const openJphFrameCodec =
  (codec: OpenJphModule): FrameCodec =>
  (frame) => {
    const decoder = new codec.HTJ2KDecoder();
    try {
      decoder.getEncodedBuffer(frame.length).set(frame);
      decoder.decode();
      const info = decoder.getFrameInfo();
      return {
        shape: {
          columns: info.width,
          rows: info.height,
          components: info.componentCount,
          bytesPerSample: info.bitsPerSample > 8 ? 2 : 1,
        },
        samples: decoder.getDecodedBuffer().slice(),
      };
    } finally {
      decoder.delete();
    }
  };
