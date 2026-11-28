import type { FrameCodec, FrameShape } from './codecFrames';

/** The decoder class every Cornerstone codec build exposes through Embind. */
export type EmbindDecoder = {
  getEncodedBuffer(length: number): Uint8Array;
  decode(): void;
  getFrameInfo(): {
    width: number;
    height: number;
    bitsPerSample: number;
    componentCount: number;
    isSigned?: boolean;
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

/** One byte samples as 16 bit words, keeping the sign a codestream gives them. */
const widened = (samples: Uint8Array, signed: boolean) =>
  new Uint8Array(
    (signed
      ? Int16Array.from(
          new Int8Array(samples.buffer, samples.byteOffset, samples.length)
        )
      : Uint16Array.from(samples)
    ).buffer
  );

/**
 * `header` is the frame shape the DICOM header declares. A codestream of 8
 * bits or fewer returns one byte per sample even where the header allocates
 * two, so those samples are widened to match.
 */
export const embindFrameCodec =
  (
    Decoder: new () => EmbindDecoder,
    header: FrameShape,
    { halvesView = false } = {}
  ): FrameCodec =>
  (frame) => {
    const decoder = new Decoder();
    try {
      decoder.getEncodedBuffer(frame.length).set(frame);
      decoder.decode();
      const info = decoder.getFrameInfo();
      const bytesPerSample = info.bitsPerSample > 8 ? 2 : 1;
      const components = info.componentCount;
      const view = decoder.getDecodedBuffer();
      // The 12 bit libjpeg-turbo build sizes its view as one byte a sample.
      const decoded = halvesView
        ? new Uint8Array(view.buffer, view.byteOffset, view.length * 2)
        : view;
      const planar = components > 1 && decoder.getInterleaveMode?.() === 0;
      const samples = planar
        ? interleaved(decoded, components, bytesPerSample)
        : decoded.slice();
      const widen = bytesPerSample < header.bytesPerSample;
      return {
        shape: {
          columns: info.width,
          rows: info.height,
          components,
          bytesPerSample: widen ? 2 : bytesPerSample,
        },
        precision: info.bitsPerSample,
        samples: widen ? widened(samples, info.isSigned === true) : samples,
      };
    } finally {
      decoder.delete();
    }
  };
