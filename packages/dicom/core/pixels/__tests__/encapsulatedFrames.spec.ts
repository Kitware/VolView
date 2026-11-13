import { describe, expect, it } from 'vitest';
import { encapsulatedPixelData, pixelItem } from '@/tests/specs/syntheticDicom';
import { splitEncapsulatedFrames } from '../encapsulatedFrames';

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];

/** A JPEG-framed codestream whose body is `body`. */
const jpeg = (...body: number[]) => Uint8Array.from([...SOI, ...body, ...EOI]);

const bytesOf = (frames: Uint8Array[]) => frames.map((frame) => [...frame]);

const DELIMITER = Uint8Array.from([0xfe, 0xff, 0xdd, 0xe0, 0, 0, 0, 0]);

const concat = (...parts: Uint8Array[]) =>
  Uint8Array.from(parts.flatMap((part) => [...part]));

describe('splitEncapsulatedFrames', () => {
  it('takes frames where a populated offset table says they start', () => {
    const frames = [
      [jpeg(1)],
      [jpeg(2, 2).subarray(0, 3), jpeg(2, 2).subarray(3)],
    ];

    const split = splitEncapsulatedFrames(
      encapsulatedPixelData({ frames, offsetTable: true }),
      2
    );

    expect(bytesOf(split)).toEqual([[...jpeg(1)], [...jpeg(2, 2)]]);
  });

  it('takes one fragment per frame when the table is empty and the counts match', () => {
    const frames = [[jpeg(1)], [jpeg(2)], [jpeg(3)]];

    const split = splitEncapsulatedFrames(encapsulatedPixelData({ frames }), 3);

    expect(bytesOf(split)).toEqual(frames.map(([only]) => [...only]));
  });

  it('joins fragments up to each JPEG End Of Image when the table is empty', () => {
    const first = jpeg(1, 1, 1, 1);
    const second = jpeg(2, 2);
    const frames = [
      [first.subarray(0, 2), first.subarray(2, 4), first.subarray(4)],
      [second.subarray(0, 4), second.subarray(4)],
    ];

    const split = splitEncapsulatedFrames(encapsulatedPixelData({ frames }), 2);

    expect(bytesOf(split)).toEqual([[...first], [...second]]);
  });

  it('ends a frame at an End Of Image followed by one pad byte', () => {
    const padded = Uint8Array.from([...jpeg(1), 0]);
    const frames = [
      [padded.subarray(0, 2), padded.subarray(2)],
      [jpeg(2, 2).subarray(0, 2), jpeg(2, 2).subarray(2)],
    ];

    const split = splitEncapsulatedFrames(encapsulatedPixelData({ frames }), 2);

    expect(bytesOf(split)).toEqual([[...padded], [...jpeg(2, 2)]]);
  });

  it('does not end a frame at an End Of Image followed by a nonzero byte', () => {
    const trailed = Uint8Array.from([...jpeg(1), 7]);
    const frames = [
      [trailed.subarray(0, 2), trailed.subarray(2)],
      [jpeg(2, 2).subarray(0, 2), jpeg(2, 2).subarray(2)],
    ];

    expect(() =>
      splitEncapsulatedFrames(encapsulatedPixelData({ frames }), 2)
    ).toThrow(/found 1 frames in 4 fragments/);
  });

  it('reads a value that ends after its last item without a delimiter', () => {
    const value = concat(
      pixelItem(new Uint8Array()),
      pixelItem(jpeg(1)),
      pixelItem(jpeg(2))
    );

    expect(bytesOf(splitEncapsulatedFrames(value, 2))).toEqual([
      [...jpeg(1)],
      [...jpeg(2)],
    ]);
  });

  it('stops at the sequence delimiter and ignores what follows', () => {
    const value = concat(
      encapsulatedPixelData({ frames: [[jpeg(1)], [jpeg(2)]] }),
      Uint8Array.from([0xfc, 0xff, 0xfc, 0xff, 4, 0, 0, 0, 9, 9, 9, 9])
    );

    expect(splitEncapsulatedFrames(value, 2)).toHaveLength(2);
  });

  it('keeps an odd item length as written', () => {
    const odd = jpeg(1, 2, 3).subarray(0, 6);
    const value = concat(
      pixelItem(new Uint8Array()),
      pixelItem(odd),
      pixelItem(jpeg(2)),
      DELIMITER
    );

    expect(bytesOf(splitEncapsulatedFrames(value, 2))).toEqual([
      [...odd],
      [...jpeg(2)],
    ]);
  });

  it.each([
    [
      'an item cut short',
      encapsulatedPixelData({ frames: [[jpeg(1)], [jpeg(2)]] }).subarray(0, 20),
      /needs 5 bytes; 4 remain/,
    ],
    [
      'an item head cut short',
      encapsulatedPixelData({ frames: [[jpeg(1)], [jpeg(2)]] }).subarray(0, 12),
      /item head at byte 8 is cut short/,
    ],
    [
      'a tag that is not an item',
      concat(
        pixelItem(new Uint8Array()),
        Uint8Array.from([0xe0, 0x7f, 0x10, 0, 2, 0, 0, 0, 1, 2])
      ),
      /expected an item at byte 8/,
    ],
    [
      'an item of undefined length',
      concat(
        pixelItem(new Uint8Array()),
        Uint8Array.from([0xfe, 0xff, 0x00, 0xe0, 0xff, 0xff, 0xff, 0xff])
      ),
      /undefined length/,
    ],
    [
      'an offset table whose length is not a multiple of four',
      concat(pixelItem(Uint8Array.from([0, 0])), pixelItem(jpeg(1)), DELIMITER),
      /Basic Offset Table holds 2 bytes/,
    ],
    [
      'an offset that starts no fragment',
      concat(
        pixelItem(Uint8Array.from([0, 0, 0, 0, 3, 0, 0, 0])),
        pixelItem(jpeg(1)),
        pixelItem(jpeg(2)),
        DELIMITER
      ),
      /entry 1 \(3\) starts no fragment/,
    ],
    [
      'an offset table that skips the first fragment',
      concat(
        pixelItem(Uint8Array.from([13, 0, 0, 0, 26, 0, 0, 0])),
        pixelItem(jpeg(1)),
        pixelItem(jpeg(2)),
        pixelItem(jpeg(3)),
        DELIMITER
      ),
      /^Malformed encapsulated Pixel Data: Basic Offset Table entry 0 \(13\) skips the first fragment$/,
    ],
    ['no offset table item', DELIMITER, /no Basic Offset Table/],
    [
      'no fragments',
      concat(pixelItem(new Uint8Array()), DELIMITER),
      /no fragments/,
    ],
  ])('rejects %s', (_name, value, error) => {
    expect(() => splitEncapsulatedFrames(value, 2)).toThrow(error);
  });

  it('rejects fragments that do not make the declared frame count', () => {
    const value = encapsulatedPixelData({
      frames: [[jpeg(1)], [jpeg(2)], [jpeg(3)]],
    });

    expect(() => splitEncapsulatedFrames(value, 2)).toThrow(
      /found 3 frames in 3 fragments; the header declares 2/
    );
  });
});
