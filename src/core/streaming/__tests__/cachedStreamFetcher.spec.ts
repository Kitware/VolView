/* eslint-disable no-restricted-syntax */
import { RequestPool } from '@/src/core/streaming/requestPool';
import {
  CachedStreamFetcher,
  StopSignal,
} from '@/src/core/streaming/cachedStreamFetcher';
import { describe, expect, it } from 'vitest';

describe('ResumableFetcher', () => {
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
      // eslint-disable-next-line no-await-in-loop
      for await (const chunk of stream) {
        size += chunk.length;
      }

      expect(size).to.equal(fetcher.size);
    }

    fetcher.close();
  });
});
