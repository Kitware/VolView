import { describe, expect, it } from 'vitest';
import {
  defaultDecoderTable,
  planDecode,
  singleDecoderTable,
} from '../decoderTable';
import { nativeFrameDecoder } from '../nativeFrame';
import { wholeInstanceDecoder, type PixelDecoder } from '../pixelDecoder';
import { pixelInstance } from './pixelFixture';

const gdcm = wholeInstanceDecoder('GDCM', () => {
  throw new Error('not decoded in these tests');
});
const table = defaultDecoderTable(gdcm);

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

  it('falls through to GDCM, whole, when native decoding declines', async () => {
    const { instance } = await pixelInstance({ photometric: 'MONOCHROME1' });

    expect(nativeFrameDecoder.plan(instance, Uint16Array)).toEqual({
      declined: expect.stringMatching(/MONOCHROME1/),
    });
    expect(planDecode(table, instance, Uint16Array)).toEqual({
      decoder: gdcm,
      units: [
        { firstFrame: 0, frames: 1, range: null, decode: expect.any(Function) },
      ],
    });
  });

  it.each([
    ['a codec GDCM provides', '1.2.840.10008.1.2.4.90'],
    ['an unlisted transfer syntax', '1.2.3.4'],
  ])('hands %s to GDCM', async (_name, syntax) => {
    const { instance } = await pixelInstance({ transferSyntaxUid: syntax });

    expect(planDecode(table, instance, Uint16Array)).toMatchObject({
      decoder: gdcm,
    });
  });

  it('names a known transfer syntax that has no decoder', async () => {
    const { instance } = await pixelInstance({
      transferSyntaxUid: '1.2.840.10008.1.2.4.102',
    });

    const plan = planDecode(table, instance, Uint16Array);

    expect('error' in plan && plan.error.message).toBe(
      'Known transfer syntax MPEG-4 AVC/H.264 High Profile (1.2.840.10008.1.2.4.102) has no decoder'
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
      planDecode(singleDecoderTable(gdcm), instance, Uint16Array)
    ).toMatchObject({ decoder: gdcm });
  });
});
