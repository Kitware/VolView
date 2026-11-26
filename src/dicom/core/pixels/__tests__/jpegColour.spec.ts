import { describe, expect, it } from 'vitest';
import { asStoredRgb } from '../jpegColour';

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

describe('asStoredRgb', () => {
  it('marks a stream that states no colour space as holding its components untransformed', () => {
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
  ])('leaves a stream with a %s segment to state its own', (_name, stated) => {
    const bytes = frame(QUANTIZATION, stated);

    expect(asStoredRgb(bytes)).toBe(bytes);
  });

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
