import { describe, expect, it } from 'vitest';
import { asStoredRgb, jpegPrecision } from '../jpegFrame';

const SOI = [0xff, 0xd8];
const QUANTIZATION = [0xff, 0xdb, 0x00, 0x04, 1, 2];
const SCAN = [0xff, 0xda, 0x00, 0x03, 9, 9, 9];
const ADOBE_NO_TRANSFORM = [
  0xff, 0xee, 0x00, 0x0e, 0x41, 0x64, 0x6f, 0x62, 0x65, 0x00, 0x64, 0x00, 0x00,
  0x00, 0x00, 0x00,
];

const segment = (code: number, text: string) => [
  0xff,
  code,
  0x00,
  2 + text.length,
  ...Array.from(text, (letter) => letter.charCodeAt(0)),
];

const frame = (...segments: number[][]) =>
  Uint8Array.from([...SOI, ...segments.flat(), ...SCAN]);

/** A frame header for one component of a two by two image. */
const startOfFrame = (code: number, precision: number) => [
  ...[0xff, code, 0x00, 0x0b, precision],
  ...[0, 2, 0, 2, 1, 1, 0x11, 0],
];

describe('jpegPrecision', () => {
  it.each([
    ['a baseline SOF0 header of 8 bits', [startOfFrame(0xc0, 8)], 8],
    ['an extended SOF1 header of 12 bits', [startOfFrame(0xc1, 12)], 12],
    ['a lossless SOF3 header of 16 bits', [startOfFrame(0xc3, 16)], 16],
    [
      'a header behind other segments',
      [segment(0xe0, 'JFIF\0'), QUANTIZATION, startOfFrame(0xc1, 12)],
      12,
    ],
    [
      'a header behind fill bytes',
      [[0xff, 0xff], QUANTIZATION, [0xff], startOfFrame(0xc1, 12)],
      12,
    ],
    [
      'a stream with no frame header ahead of its scan',
      [QUANTIZATION],
      undefined,
    ],
    [
      'a Huffman table, whose marker sits among the frame headers',
      [startOfFrame(0xc4, 12)],
      undefined,
    ],
  ])('reads %s', (_name, segments, precision) => {
    expect(jpegPrecision(frame(...segments))).toBe(precision);
  });
});

describe('asStoredRgb', () => {
  it('marks a stream that states no color space as holding its components untransformed', () => {
    expect(Array.from(asStoredRgb(frame(QUANTIZATION)))).toEqual([
      ...SOI,
      ...ADOBE_NO_TRANSFORM,
      ...QUANTIZATION,
      ...SCAN,
    ]);
  });

  it.each([
    ['JFIF', segment(0xe0, 'JFIF\0')],
    ['Adobe', segment(0xee, 'Adobe\0\0\0\0\0\0\u0001')],
  ])(
    'leaves a stream with a %s segment behind a fill byte to state its own',
    (_name, stated) => {
      const bytes = frame(QUANTIZATION, [0xff], stated);

      expect(asStoredRgb(bytes)).toBe(bytes);
    }
  );

  it('does not take another application segment for a statement', () => {
    const bytes = frame(segment(0xe0, 'JFXX\0'));

    expect(asStoredRgb(bytes)).toHaveLength(
      bytes.length + ADOBE_NO_TRANSFORM.length
    );
  });

  it('ignores a marker that only appears in the entropy coded scan', () => {
    const bytes = Uint8Array.from([
      ...SOI,
      ...SCAN,
      ...segment(0xe0, 'JFIF\0'),
    ]);

    expect(asStoredRgb(bytes)).toHaveLength(
      bytes.length + ADOBE_NO_TRANSFORM.length
    );
  });
});
