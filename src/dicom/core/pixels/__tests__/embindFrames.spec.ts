import { describe, expect, it } from 'vitest';
import { embindFrameCodec, type EmbindDecoder } from '../embindFrames';

type Decoded = {
  info: ReturnType<EmbindDecoder['getFrameInfo']>;
  bytes: number[];
  interleaveMode?: number;
};

/** A codec build's decoder class, which decodes any frame to `decoded`. */
function decoderClass(decoded: Decoded) {
  const log: string[] = [];
  const heap = Uint8Array.from(decoded.bytes);
  class Decoder implements EmbindDecoder {
    getEncodedBuffer = (length: number) => new Uint8Array(length);
    decode = () => log.push('decode');
    getFrameInfo = () => decoded.info;
    getDecodedBuffer = () => heap;
    delete = () => log.push('delete');
    getInterleaveMode =
      decoded.interleaveMode === undefined
        ? undefined
        : () => decoded.interleaveMode!;
  }
  return { Decoder, heap, log };
}

/** A header whose samples are as wide as the decoder's. */
const header = (bytesPerSample: number) => ({
  columns: 2,
  rows: 1,
  components: 1,
  bytesPerSample,
});

const info = (overrides: Partial<Decoded['info']>) => ({
  width: 2,
  height: 1,
  bitsPerSample: 8,
  componentCount: 1,
  ...overrides,
});

describe('embindFrameCodec', () => {
  it('copies the samples off the heap and frees the decoder', () => {
    const { Decoder, heap, log } = decoderClass({
      info: info({ bitsPerSample: 12 }),
      bytes: [1, 2, 3, 4],
    });

    const frame = embindFrameCodec(Decoder, header(2))(new Uint8Array(3));
    heap.fill(0);

    expect(frame).toEqual({
      shape: { columns: 2, rows: 1, components: 1, bytesPerSample: 2 },
      precision: 12,
      samples: Uint8Array.from([1, 2, 3, 4]),
    });
    expect(log).toEqual(['decode', 'delete']);
  });

  it('interleaves components a JPEG-LS stream returns as planes', () => {
    const { Decoder } = decoderClass({
      info: info({ componentCount: 3, bitsPerSample: 16 }),
      bytes: [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6],
      interleaveMode: 0,
    });

    const { samples } = embindFrameCodec(Decoder, header(2))(new Uint8Array(3));

    expect(Array.from(samples)).toEqual([1, 1, 3, 3, 5, 5, 2, 2, 4, 4, 6, 6]);
  });

  it('keeps samples a stream already interleaves', () => {
    const { Decoder } = decoderClass({
      info: info({ componentCount: 3 }),
      bytes: [1, 2, 3, 4, 5, 6],
      interleaveMode: 2,
    });

    const { samples } = embindFrameCodec(Decoder, header(1))(new Uint8Array(3));

    expect(Array.from(samples)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it.each([
    ['signed', true, [0xff, 0xff, 0x05, 0x00]],
    ['unsigned', false, [0xff, 0x00, 0x05, 0x00]],
  ])(
    'widens %s 8 bit samples to the 16 bits the header allocates',
    (_name, isSigned, words) => {
      const { Decoder } = decoderClass({
        info: info({ isSigned }),
        bytes: [0xff, 0x05],
      });

      const frame = embindFrameCodec(Decoder, header(2))(new Uint8Array(3));

      expect(frame).toEqual({
        shape: { columns: 2, rows: 1, components: 1, bytesPerSample: 2 },
        precision: 8,
        samples: Uint8Array.from(words),
      });
    }
  );

  it('frees the decoder of a frame that does not decode', () => {
    const { Decoder, log } = decoderClass({ info: info({}), bytes: [] });
    class Failing extends Decoder {
      decode = () => {
        throw new Error('bad codestream');
      };
    }

    expect(() =>
      embindFrameCodec(Failing, header(1))(new Uint8Array(3))
    ).toThrow('bad codestream');
    expect(log).toEqual(['delete']);
  });
});
