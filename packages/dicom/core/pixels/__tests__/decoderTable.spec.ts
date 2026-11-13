import { describe, expect, it } from 'vitest';
import {
  defaultDecoderTable,
  planDecode,
  wholeInstanceDecoderTable,
} from '../decoderTable';
import { pixelInstance } from './pixelFixture';

describe('planDecode', () => {
  it('plans native frames for an uncompressed instance it reproduces', async () => {
    const { instance } = await pixelInstance({ frames: 3 });

    const plan = planDecode(defaultDecoderTable, instance);

    expect(plan).toMatchObject({
      kind: 'frames',
      format: { rows: 5, columns: 3, bitsAllocated: 16 },
    });
    expect(plan.kind === 'frames' && plan.index.frames).toHaveLength(3);
  });

  it('hands a declined uncompressed instance to the whole-instance decoder', async () => {
    const { instance } = await pixelInstance({ photometric: 'MONOCHROME1' });

    expect(planDecode(defaultDecoderTable, instance)).toEqual({
      kind: 'whole-instance',
      reason: expect.stringMatching(/MONOCHROME1/),
    });
  });

  it.each([
    ['a codec GDCM provides', '1.2.840.10008.1.2.4.90'],
    ['an unlisted transfer syntax', '1.2.3.4'],
  ])('hands %s to the whole-instance decoder', async (_name, syntax) => {
    const { instance } = await pixelInstance({ transferSyntaxUid: syntax });

    expect(planDecode(defaultDecoderTable, instance)).toEqual({
      kind: 'whole-instance',
    });
  });

  it('names a known transfer syntax that has no decoder', async () => {
    const { instance } = await pixelInstance({
      transferSyntaxUid: '1.2.840.10008.1.2.4.102',
    });

    const plan = planDecode(defaultDecoderTable, instance);

    expect(plan.kind === 'unsupported' && plan.error.message).toBe(
      'Known transfer syntax MPEG-4 AVC/H.264 High Profile (1.2.840.10008.1.2.4.102) has no decoder'
    );
  });

  it('leaves everything to an injected whole-instance decoder', async () => {
    const { instance } = await pixelInstance();

    expect(planDecode(wholeInstanceDecoderTable, instance)).toEqual({
      kind: 'whole-instance',
    });
  });
});
