import { RequestPool } from '@/src/core/streaming/requestPool';
import {
  CachedStreamFetcher,
  sliceChunks,
  StopSignal,
} from '@/src/core/streaming/cachedStreamFetcher';
import { describe, expect, it } from 'vitest';

describe('CachedStreamFetcher', () => {
  it('should support stopping and resuming', async () => {
    const pool = new RequestPool();
    const fetcher = new CachedStreamFetcher(
      'https://data.kitware.com/api/v1/file/57b5d4648d777f10f2693e7e/download',
      {
        fetch: pool.fetch,
      }
    );

    await fetcher.connect();
    let stream = fetcher.getStream();
    let size = 0;
    try {
      // @ts-ignore
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > 4096 * 3) {
          break;
        }
      }
    } catch (err) {
      if (err !== StopSignal) throw err;
    } finally {
      fetcher.close();
    }

    await fetcher.connect();

    // ensure we can read the stream multiple times
    for (let i = 0; i < 2; i++) {
      stream = fetcher.getStream();
      size = 0;
      // @ts-ignore

      for await (const chunk of stream) {
        size += chunk.length;
      }

      expect(size).to.equal(fetcher.size);
    }

    fetcher.close();
  });
});

describe('sliceChunks', () => {
  it('should work', () => {
    expect(sliceChunks([new Uint8Array([1, 2, 3])], 0)).toEqual([]);
    expect(sliceChunks([new Uint8Array([1, 2, 3])], 1)).toEqual([
      new Uint8Array([1]),
    ]);
    expect(sliceChunks([new Uint8Array([1])], 1)).toEqual([
      new Uint8Array([1]),
    ]);
    expect(sliceChunks([new Uint8Array([1, 2])], 1)).toEqual([
      new Uint8Array([1]),
    ]);
    expect(sliceChunks([new Uint8Array([1, 2])], 3)).toEqual([
      new Uint8Array([1, 2]),
    ]);
    expect(
      sliceChunks([new Uint8Array([1, 2]), new Uint8Array([3, 4])], 3)
    ).toEqual([new Uint8Array([1, 2]), new Uint8Array([3])]);
  });
});
