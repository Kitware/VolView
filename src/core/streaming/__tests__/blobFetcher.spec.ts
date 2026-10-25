import { describe, expect, it } from 'vitest';
import { blobFetcher } from '@/src/core/streaming/blobFetcher';
import { StopSignal } from '@/src/core/streaming/cachedStreamFetcher';
import { concatBytes } from '@/src/utils';

const KIB = 1024;

const bytesOf = (length: number) =>
  Uint8Array.from({ length }, (_, index) => index % 251);

const drain = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  into: Uint8Array[] = []
) => {
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return into;
    into.push(value);
  }
};

const readAll = (stream: ReadableStream<Uint8Array>) =>
  drain(stream.getReader());

const lengthOf = (chunks: Uint8Array[]) =>
  chunks.reduce((total, chunk) => total + chunk.length, 0);

describe('blobFetcher', () => {
  it('streams the blob from its first byte in slices', async () => {
    const bytes = bytesOf(200 * KIB);
    const fetcher = blobFetcher(new Blob([bytes]));
    await fetcher.connect();

    const chunks = await readAll(fetcher.getStream());

    expect(chunks.length).toBeGreaterThan(1);
    expect(concatBytes(chunks)).toEqual(bytes);
  });

  // A meta load cut short and started again must not see the first stream's
  // bytes ahead of its own.
  it('starts every stream at the first byte', async () => {
    const bytes = bytesOf(200 * KIB);
    const fetcher = blobFetcher(new Blob([bytes]));
    await fetcher.connect();

    const first = fetcher.getStream().getReader();
    await first.read();
    const second = await readAll(fetcher.getStream());

    expect(concatBytes(second)).toEqual(bytes);
  });

  it('ends a stream in flight once closed', async () => {
    const bytes = bytesOf(400 * KIB);
    const fetcher = blobFetcher(new Blob([bytes]));
    await fetcher.connect();
    const reader = fetcher.getStream().getReader();
    const delivered = [(await reader.read()).value!];

    fetcher.close();

    await expect(drain(reader, delivered)).rejects.toBe(StopSignal);
    expect(lengthOf(delivered)).toBeLessThan(bytes.length);
    expect(fetcher.connected).toBe(false);
  });

  it('does not revive a closed stream when reconnected', async () => {
    const fetcher = blobFetcher(new Blob([bytesOf(400 * KIB)]));
    await fetcher.connect();
    const reader = fetcher.getStream().getReader();

    fetcher.close();
    await fetcher.connect();

    await expect(drain(reader)).rejects.toBe(StopSignal);
    expect(concatBytes(await readAll(fetcher.getStream()))).toHaveLength(
      400 * KIB
    );
  });

  it('closes a stream opened before connecting', async () => {
    const fetcher = blobFetcher(new Blob([bytesOf(10)]));

    expect(await readAll(fetcher.getStream())).toEqual([]);
  });

  it('hands out the blob itself as the whole data', async () => {
    const blob = new Blob([bytesOf(10)]);

    expect(await blobFetcher(blob).blob()).toBe(blob);
  });

  it('keeps no copy of what it streamed', async () => {
    const fetcher = blobFetcher(new Blob([bytesOf(10)]));
    await fetcher.connect();
    await readAll(fetcher.getStream());

    expect(fetcher.cachedChunks).toBeUndefined();
  });
});
