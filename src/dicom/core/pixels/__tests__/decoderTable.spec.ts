import { describe, expect, it } from 'vitest';
import {
  defaultDecoderTable,
  planDecode,
  singleDecoderTable,
} from '../decoderTable';
import { deflatedDecoder } from '../deflatedDecoder';
import { nativeFrameDecoder } from '../nativeFrame';
import { wholeInstanceDecoder, type PixelDecoder } from '../pixelDecoder';
import { pixelInstance } from './pixelFixture';

const undecoded = (name: string) =>
  wholeInstanceDecoder(name, () => {
    throw new Error('not decoded in these tests');
  });
const codecs = {
  htj2k: undecoded('HTJ2K'),
  jpeg: undecoded('JPEG'),
  jpegLossless: undecoded('JPEG Lossless'),
  jpeg2000: undecoded('JPEG 2000'),
  jpegLs: undecoded('JPEG-LS'),
  rle: undecoded('RLE'),
};
const table = defaultDecoderTable(codecs);

const declining = (name: string, reason: string): PixelDecoder => ({
  name,
  plan: () => ({ declined: reason }),
});

describe('planDecode', () => {
  it('plans a native unit per frame for an uncompressed instance it reproduces', async () => {
    const { instance } = await pixelInstance({ frames: 3 });

    const plan = planDecode(table, instance, Uint16Array);

    expect('decoder' in plan && plan.decoder).toBe(nativeFrameDecoder);
    expect('units' in plan && plan.units).toMatchObject([
      { firstFrame: 0, frames: 1 },
      { firstFrame: 1, frames: 1 },
      { firstFrame: 2, frames: 1 },
    ]);
  });

  it.each([
    ['RLE Lossless', '1.2.840.10008.1.2.5', codecs.rle],
    ['Deflated', '1.2.840.10008.1.2.1.99', deflatedDecoder],
    ['JPEG Baseline', '1.2.840.10008.1.2.4.50', codecs.jpeg],
    ['JPEG Extended', '1.2.840.10008.1.2.4.51', codecs.jpeg],
    ['JPEG Lossless', '1.2.840.10008.1.2.4.57', codecs.jpegLossless],
    ['JPEG Lossless SV1', '1.2.840.10008.1.2.4.70', codecs.jpegLossless],
    ['JPEG-LS Lossless', '1.2.840.10008.1.2.4.80', codecs.jpegLs],
    ['JPEG-LS Near-Lossless', '1.2.840.10008.1.2.4.81', codecs.jpegLs],
    ['JPEG 2000 Lossless', '1.2.840.10008.1.2.4.90', codecs.jpeg2000],
    ['JPEG 2000', '1.2.840.10008.1.2.4.91', codecs.jpeg2000],
    ['HTJ2K Lossless', '1.2.840.10008.1.2.4.201', codecs.htj2k],
    ['HTJ2K RPCL Lossless', '1.2.840.10008.1.2.4.202', codecs.htj2k],
    ['HTJ2K', '1.2.840.10008.1.2.4.203', codecs.htj2k],
  ])(
    'hands %s to the one decoder of its syntax',
    async (_name, transferSyntaxUid, own) => {
      const { instance } = await pixelInstance();

      expect(
        planDecode(table, { ...instance, transferSyntaxUid }, Uint16Array)
      ).toMatchObject({ decoder: own });
      expect(table.byTransferSyntax.get(transferSyntaxUid)).toHaveLength(1);
    }
  );

  it.each([
    [
      'a known syntax without one',
      '1.2.840.10008.1.2.4.102',
      'Known transfer syntax MPEG-4 AVC/H.264 High Profile (1.2.840.10008.1.2.4.102)',
    ],
    [
      'another known syntax without one',
      '1.2.840.10008.1.2.4.112',
      'Known transfer syntax JPEG XL (1.2.840.10008.1.2.4.112)',
    ],
    ['an unlisted syntax', '1.2.3.4', 'Transfer syntax 1.2.3.4'],
    ['a missing syntax', null, 'Transfer syntax unknown'],
  ])('says %s has no decoder', async (_name, transferSyntaxUid, what) => {
    const { instance } = await pixelInstance();

    const plan = planDecode(
      table,
      { ...instance, transferSyntaxUid },
      Uint16Array
    );

    expect('error' in plan && plan.error.message).toBe(
      `${what} has no decoder`
    );
  });

  it('takes the first candidate that accepts, in the order listed', async () => {
    const { instance } = await pixelInstance();
    const first = wholeInstanceDecoder('First', () => {
      throw new Error('unused');
    });
    const second = wholeInstanceDecoder('Second', () => {
      throw new Error('unused');
    });
    const ordered = {
      ...singleDecoderTable(first),
      fallback: [declining('Picky', 'not today'), first, second],
    };

    expect(planDecode(ordered, instance, Uint16Array)).toMatchObject({
      decoder: first,
    });
  });

  it('says why every candidate declined', async () => {
    const { instance } = await pixelInstance();
    const syntax = instance.transferSyntaxUid!;
    const picky = {
      ...table,
      byTransferSyntax: new Map([
        [syntax, [declining('A', 'too big'), declining('B', 'too small')]],
      ]),
    };

    const plan = planDecode(picky, instance, Uint16Array);

    expect('error' in plan && plan.error.message).toBe(
      'Known transfer syntax Explicit VR Little Endian (1.2.840.10008.1.2.1) has no decoder: A declined (too big); B declined (too small)'
    );
  });

  it('sends every instance to the one decoder of a single-decoder table', async () => {
    const { instance } = await pixelInstance();

    expect(
      planDecode(singleDecoderTable(codecs.rle), instance, Uint16Array)
    ).toMatchObject({ decoder: codecs.rle });
  });
});
