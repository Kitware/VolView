import { concatBytes, toAscii } from '../utils';

const SOI_LENGTH = 2;
const SOS = 0xda;
/** The segments a JPEG decoder reads the color space from, by marker code. */
const COLOR_SEGMENTS = new Map([
  [0xe0, 'JFIF'],
  [0xee, 'Adobe'],
]);

// An Adobe APP14 segment whose transform is 0: components are stored as they are.
// prettier-ignore
const ADOBE_NO_TRANSFORM = Uint8Array.from([
  0xff, 0xee, 0x00, 0x0e, 0x41, 0x64, 0x6f, 0x62, 0x65, 0x00, 0x64, 0x00, 0x00,
  0x00, 0x00, 0x00,
]);

/** The marker code and payload of each segment ahead of the first scan. */
function* segmentsBeforeScan(frame: Uint8Array) {
  let at = SOI_LENGTH;
  while (at + 4 <= frame.length && frame[at] === 0xff) {
    const code = frame[at + 1];
    // Any marker may be preceded by 0xFF fill bytes (ISO 10918-1 B.1.1.2).
    if (code === 0xff) {
      at += 1;
      continue;
    }
    if (code === SOS) return;
    const length = (frame[at + 2] << 8) | frame[at + 3];
    yield { code, payload: frame.subarray(at + 4, at + 2 + length) };
    at += 2 + length;
  }
}

/** Whether a JFIF or Adobe segment ahead of the first scan states the color space. */
const statesColorSpace = (frame: Uint8Array) =>
  [...segmentsBeforeScan(frame)].some(({ code, payload }) => {
    const name = COLOR_SEGMENTS.get(code);
    return name && toAscii(payload.subarray(0, name.length)) === name;
  });

// Start of frame markers are C0 to CF, less the three that define tables.
const isStartOfFrame = (code: number) =>
  code >= 0xc0 && code <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(code);

/** Bits per sample the frame header of a JPEG stream declares, or undefined. */
export const jpegPrecision = (frame: Uint8Array) =>
  [...segmentsBeforeScan(frame)].find(({ code }) => isStartOfFrame(code))
    ?.payload[0];

/**
 * A JPEG frame whose header says RGB, marked so a decoder does not take its
 * three components for YCbCr, as it does for a stream that says nothing.
 * A stream that states its own color space is left to say so.
 */
export const asStoredRgb = (frame: Uint8Array) =>
  statesColorSpace(frame)
    ? frame
    : concatBytes([
        frame.subarray(0, SOI_LENGTH),
        ADOBE_NO_TRANSFORM,
        frame.subarray(SOI_LENGTH),
      ]);
