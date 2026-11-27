import { describe, expect, it } from 'vitest';
import { deflatedDecoder } from '../deflatedDecoder';
import { readInstance } from '../../instance/readInstance';
import { fromBlob } from '../../source/byteSource';
import { concatBytes } from '../../utils';
import {
  nativePixelDicom,
  type NativePixelOptions,
} from '@/tests/nativePixelDicom';

const DEFLATED = '1.2.840.10008.1.2.1.99';
const signal = () => new AbortController().signal;

const blobOf = (bytes: Uint8Array) =>
  new Blob([bytes as Uint8Array<ArrayBuffer>]);

/** A file whose data set, everything past the file meta information, is deflated. */
async function deflatedFile(options: NativePixelOptions, trailing = 0) {
  const file = nativePixelDicom({ ...options, transferSyntaxUid: DEFLATED });
  const metaEnd = 144 + new DataView(file.buffer).getUint32(140, true);
  const deflated = blobOf(file.subarray(metaEnd))
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return concatBytes([
    file.subarray(0, metaEnd),
    new Uint8Array(await new Response(deflated).arrayBuffer()),
    new Uint8Array(trailing).fill(7),
  ]);
}

async function decode(options: NativePixelOptions, trailing = 0) {
  const bytes = await deflatedFile(options, trailing);
  const instance = await readInstance(fromBlob(blobOf(bytes)), signal());
  const units = deflatedDecoder.plan(instance, Int16Array);
  if ('declined' in units) throw new Error(units.declined);
  return { units, pixels: await units[0].decode(bytes, signal()) };
}

describe('deflatedDecoder', () => {
  it('inflates the data set and decodes every frame from one whole read', async () => {
    const { units, pixels } = await decode({
      rows: 1,
      columns: 2,
      frames: 2,
      words: [1, 2, 3, 4],
      rescale: [2, -1],
    });

    expect(units).toMatchObject([{ firstFrame: 0, frames: 2, range: null }]);
    expect(Array.from(pixels.data)).toEqual([1, 3, 5, 7]);
    expect(pixels).toMatchObject({
      size: [2, 1, 2],
      components: 1,
      range: [[1, 7]],
    });
  });

  it('rescales each frame by its own Pixel Value Transformation', async () => {
    const { pixels } = await decode({
      sopClassUid: '1.2.840.10008.5.1.4.1.1.2.1',
      rows: 1,
      columns: 2,
      frames: 2,
      words: [1, 2, 3, 4],
      frameRescales: [
        [1, 0],
        [2, 10],
      ],
    });

    expect(Array.from(pixels.data)).toEqual([1, 2, 16, 18]);
  });

  it('ignores bytes that follow the deflate stream', async () => {
    const { pixels } = await decode({ rows: 1, columns: 2, words: [5, 6] }, 8);

    expect(Array.from(pixels.data)).toEqual([5, 6]);
  });

  it('declines what native frames decline', async () => {
    const bytes = await deflatedFile({
      samplesPerPixel: 3,
      bitsAllocated: 8,
      photometric: 'YBR_PARTIAL_420',
    });
    const instance = await readInstance(fromBlob(blobOf(bytes)), signal());

    expect(deflatedDecoder.plan(instance, Uint8Array)).toEqual({
      declined: expect.stringMatching(/YBR_PARTIAL_420/),
    });
  });
});
