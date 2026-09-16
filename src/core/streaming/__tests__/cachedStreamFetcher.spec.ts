import { RequestPool } from '@/src/core/streaming/requestPool';
import {
  CachedStreamFetcher,
  sliceChunks,
} from '@/src/core/streaming/cachedStreamFetcher';
import { describe, expect, it } from 'vitest';

const readStream = async (
  stream: ReadableStream<Uint8Array>,
  stopAfter = Infinity
) => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let completed = false;
  try {
    while (size <= stopAfter) {
      const result = await reader.read();
      if (result.done) {
        completed = true;
        break;
      }
      chunks.push(result.value);
      size += result.value.length;
    }
  } finally {
    if (!completed) await reader.cancel();
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.length;
  });
  return bytes;
};

describe('CachedStreamFetcher', () => {
  it('should support stopping and resuming', async () => {
    const source = Uint8Array.from(
      { length: 32 * 1024 + 123 },
      (_, index) => (index * 31) % 251
    );
    const requestedRanges: Array<string | null> = [];
    const fetchRange: typeof fetch = async (_input, init) => {
      const range = new Headers(init?.headers).get('Range');
      requestedRanges.push(range);
      const start = range ? Number(range.match(/^bytes=(\d+)-$/)?.[1]) : 0;
      let offset = start;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset === source.length) {
            controller.close();
            return;
          }
          const end = Math.min(offset + 4096, source.length);
          controller.enqueue(source.slice(offset, end));
          offset = end;
        },
      });
      return new Response(body, {
        status: start === 0 ? 200 : 206,
        headers: {
          'content-length': String(source.length - start),
          ...(start === 0
            ? {}
            : {
                'content-range': `bytes ${start}-${source.length - 1}/${source.length}`,
              }),
        },
      });
    };
    const pool = new RequestPool(1, fetchRange);
    const fetcher = new CachedStreamFetcher('https://example.test/data', {
      fetch: pool.fetch,
    });

    await fetcher.connect();
    const partial = await readStream(fetcher.getStream(), 4096 * 3);
    expect(partial).toEqual(source.slice(0, partial.length));
    const resumeAt = fetcher.size;
    expect(resumeAt).toBeGreaterThanOrEqual(partial.length);
    expect(resumeAt).toBeLessThan(source.length);
    fetcher.close();

    await fetcher.connect();
    expect(requestedRanges).toEqual([null, `bytes=${resumeAt}-`]);

    for (let i = 0; i < 2; i++) {
      expect(await readStream(fetcher.getStream())).toEqual(source);
    }
    expect(fetcher.size).toBe(source.length);
    expect(requestedRanges).toHaveLength(2);

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
