import { concatBytes, toAscii } from '../utils';

const SOI_LENGTH = 2;
const SOS = 0xda;
/** The segments a JPEG decoder reads the colour space from, by marker code. */
const COLOUR_SEGMENTS = new Map([
  [0xe0, 'JFIF'],
  [0xee, 'Adobe'],
]);

// An Adobe APP14 segment whose transform is 0: components are stored as they are.
// prettier-ignore
const ADOBE_NO_TRANSFORM = Uint8Array.from([
  0xff, 0xee, 0x00, 0x0e, 0x41, 0x64, 0x6f, 0x62, 0x65, 0x00, 0x64, 0x00, 0x00,
  0x00, 0x00, 0x00,
]);

/** Whether a JFIF or Adobe segment ahead of the first scan states the colour space. */
function statesColourSpace(frame: Uint8Array) {
  let at = SOI_LENGTH;
  while (at + 4 <= frame.length && frame[at] === 0xff) {
    const code = frame[at + 1];
    if (code === SOS) return false;
    const name = COLOUR_SEGMENTS.get(code);
    if (name && toAscii(frame.subarray(at + 4, at + 4 + name.length)) === name)
      return true;
    at += 2 + ((frame[at + 2] << 8) | frame[at + 3]);
  }
  return false;
}

/**
 * A JPEG frame whose header says RGB, marked so a decoder does not take its
 * three components for YCbCr, as it does for a stream that says nothing.
 * A stream that states its own colour space is left to say so.
 */
export const asStoredRgb = (frame: Uint8Array) =>
  statesColourSpace(frame)
    ? frame
    : concatBytes([
        frame.subarray(0, SOI_LENGTH),
        ADOBE_NO_TRANSFORM,
        frame.subarray(SOI_LENGTH),
      ]);
