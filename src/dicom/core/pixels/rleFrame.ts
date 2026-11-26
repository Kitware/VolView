import type { FrameCodec, FrameShape } from './codecFrames';

const HEADER_LENGTH = 64;

/**
 * Unpacks one PackBits segment into every `stride`th byte of `out` from
 * `first`: a control byte below 128 copies that many bytes plus one, one
 * above it repeats the next byte 257 minus that many times, and 128 does
 * nothing. A segment may carry pad bytes past its last pixel.
 */
function unpackSegment(
  segment: Uint8Array,
  out: Uint8Array,
  first: number,
  stride: number
) {
  let read = 0;
  let write = first;
  while (read < segment.length && write < out.length) {
    const control = segment[read];
    if (control < 128) {
      for (let step = 1; step <= control + 1 && write < out.length; step += 1) {
        out[write] = segment[read + step];
        write += stride;
      }
      read += control + 2;
    } else if (control > 128) {
      const value = segment[read + 1];
      for (let step = control; step <= 256 && write < out.length; step += 1) {
        out[write] = value;
        write += stride;
      }
      read += 2;
    } else read += 1;
  }
  return write;
}

function segmentsOf(frame: Uint8Array, expected: number) {
  if (frame.length < HEADER_LENGTH)
    throw new Error('The RLE header is cut short');
  const view = new DataView(frame.buffer, frame.byteOffset, HEADER_LENGTH);
  const count = view.getUint32(0, true);
  if (count !== expected)
    throw new Error(`${count} RLE segments where ${expected} are needed`);
  const offsets = Array.from({ length: count }, (_, index) =>
    view.getUint32(4 + index * 4, true)
  );
  return offsets.map((offset, index) =>
    frame.subarray(offset, offsets[index + 1] ?? frame.length)
  );
}

/**
 * A frame's segments hold one byte plane each: components in order, and
 * within a component the most significant byte first.
 */
export const rleFrameCodec =
  (shape: FrameShape): FrameCodec =>
  (frame) => {
    const { columns, rows, components, bytesPerSample } = shape;
    const stride = components * bytesPerSample;
    const samples = new Uint8Array(columns * rows * stride);
    segmentsOf(frame, stride).forEach((segment, index) => {
      const component = Math.floor(index / bytesPerSample);
      const byte = bytesPerSample - 1 - (index % bytesPerSample);
      const first = component * bytesPerSample + byte;
      const end = unpackSegment(segment, samples, first, stride);
      if (end < samples.length)
        throw new Error(
          `RLE segment ${index + 1} holds ${(end - first) / stride} of ${columns * rows} bytes`
        );
    });
    return { shape, samples };
  };
