import type { FrameCodec } from './codecFrames';

/** The decoder class every Cornerstone codec build exposes through Embind. */
export type EmbindDecoder = {
  getEncodedBuffer(length: number): Uint8Array;
  decode(): void;
  getFrameInfo(): {
    width: number;
    height: number;
    bitsPerSample: number;
    componentCount: number;
  };
  /** A view of the WASM heap, valid until the next call. */
  getDecodedBuffer(): Uint8Array;
  /** JPEG-LS only: 0 when the components come back as separate planes. */
  getInterleaveMode?(): number;
  /** The object lives on the WASM heap until this is called. */
  delete(): void;
};

function interleaved(planes: Uint8Array, components: number, width: number) {
  const pixels = planes.length / (components * width);
  const samples = new Uint8Array(planes.length);
  for (let component = 0; component < components; component += 1)
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      const from = (component * pixels + pixel) * width;
      const to = (pixel * components + component) * width;
      samples.set(planes.subarray(from, from + width), to);
    }
  return samples;
}

export const embindFrameCodec =
  (Decoder: new () => EmbindDecoder): FrameCodec =>
  (frame) => {
    const decoder = new Decoder();
    try {
      decoder.getEncodedBuffer(frame.length).set(frame);
      decoder.decode();
      const info = decoder.getFrameInfo();
      const shape = {
        columns: info.width,
        rows: info.height,
        components: info.componentCount,
        bytesPerSample: info.bitsPerSample > 8 ? 2 : 1,
      };
      const decoded = decoder.getDecodedBuffer();
      const planar =
        shape.components > 1 && decoder.getInterleaveMode?.() === 0;
      return {
        shape,
        samples: planar
          ? interleaved(decoded, shape.components, shape.bytesPerSample)
          : decoded.slice(),
      };
    } finally {
      decoder.delete();
    }
  };
