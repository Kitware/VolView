import { describe, expect, it } from 'vitest';
import { rleFrameCodec } from '../rleFrame';

/** An RLE frame: the 64 byte header of segment offsets, then the segments. */
function rleFrame(segments: number[][]) {
  const header = new DataView(new ArrayBuffer(64));
  header.setUint32(0, segments.length, true);
  let offset = 64;
  segments.forEach((segment, index) => {
    header.setUint32(4 + index * 4, offset, true);
    offset += segment.length;
  });
  return Uint8Array.from([
    ...new Uint8Array(header.buffer),
    ...segments.flat(),
  ]);
}

const shape = (overrides: object) => ({
  columns: 4,
  rows: 1,
  components: 1,
  bytesPerSample: 1,
  ...overrides,
});

describe('rleFrameCodec', () => {
  it('copies literal runs, repeats replicate runs and skips the no-op byte', () => {
    // Two literals, a no-op, then one byte twice; a pad byte ends the segment.
    const frame = rleFrame([[1, 10, 20, 128, 255, 7, 0]]);

    const { samples } = rleFrameCodec(shape({}))(frame);

    expect(Array.from(samples)).toEqual([10, 20, 7, 7]);
  });

  it('joins the byte planes of a sample, most significant first, into little endian words', () => {
    const high = [3, 0x01, 0x02, 0x03, 0x04];
    const low = [3, 0xa1, 0xa2, 0xa3, 0xa4];

    const { samples } = rleFrameCodec(shape({ bytesPerSample: 2 }))(
      rleFrame([high, low])
    );

    expect(Array.from(new Uint16Array(samples.buffer))).toEqual([
      0x01a1, 0x02a2, 0x03a3, 0x04a4,
    ]);
  });

  it('interleaves the planes of color components', () => {
    const plane = (value: number) => [255, value];

    const { samples } = rleFrameCodec(shape({ columns: 2, components: 3 }))(
      rleFrame([plane(1), plane(2), plane(3)])
    );

    expect(Array.from(samples)).toEqual([1, 2, 3, 1, 2, 3]);
  });

  it('refuses a frame with another number of segments than its samples need', () => {
    expect(() =>
      rleFrameCodec(shape({ bytesPerSample: 2 }))(rleFrame([[3, 1, 2, 3, 4]]))
    ).toThrow('1 RLE segments where 2 are needed');
  });

  it('refuses a segment that ends before its plane is full', () => {
    expect(() => rleFrameCodec(shape({}))(rleFrame([[1, 10, 20]]))).toThrow(
      'RLE segment 1 holds 2 of 4 bytes'
    );
  });
});
