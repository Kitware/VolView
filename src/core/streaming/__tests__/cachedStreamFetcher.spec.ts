import { CachedStreamFetcher } from '@/src/core/streaming/cachedStreamFetcher';
import { expect, it } from 'vitest';

const SOURCE = Uint8Array.from(
  { length: 3 * 4096 + 123 },
  (_, index) => (index * 31) % 251
);

/** Serves SOURCE in 4096 byte chunks, recording each request's signal. */
function serving() {
  const signals: AbortSignal[] = [];
  const fetchSource: typeof fetch = async (_input, init) => {
    signals.push(init!.signal!);
    let offset = 0;
    return new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset === SOURCE.length) {
            controller.close();
            return;
          }
          const end = Math.min(offset + 4096, SOURCE.length);
          controller.enqueue(SOURCE.slice(offset, end));
          offset = end;
        },
      })
    );
  };
  return { signals, fetchSource };
}

const bytesOf = async (stream: ReadableStream<Uint8Array>) =>
  new Uint8Array(await new Response(stream).arrayBuffer());

it('replays one download from its start to every stream', async () => {
  const { signals, fetchSource } = serving();
  const fetcher = new CachedStreamFetcher('https://example.test/data', {
    fetch: fetchSource,
  });
  await fetcher.connect();

  const reader = fetcher.getStream().getReader();
  const first = await reader.read();
  await reader.cancel();
  expect(first.value).toEqual(SOURCE.slice(0, 4096));

  await fetcher.connect();
  expect(await bytesOf(fetcher.getStream())).toEqual(SOURCE);
  expect(await bytesOf(fetcher.getStream())).toEqual(SOURCE);
  expect(new Uint8Array(await (await fetcher.blob()).arrayBuffer())).toEqual(
    SOURCE
  );
  expect(signals).toHaveLength(1);
});

it('releases its request once the download is read to its end', async () => {
  const { signals, fetchSource } = serving();
  const fetcher = new CachedStreamFetcher('https://example.test/data', {
    fetch: fetchSource,
  });
  await fetcher.connect();
  expect(signals[0].aborted).toBe(false);

  await fetcher.blob();

  expect(signals[0].aborted).toBe(true);
  expect(fetcher.connected).toBe(true);
  expect(await bytesOf(fetcher.getStream())).toEqual(SOURCE);
});

it('aborts its request and ends its streams when closed', async () => {
  const { signals, fetchSource } = serving();
  const fetcher = new CachedStreamFetcher('https://example.test/data', {
    fetch: fetchSource,
  });
  await fetcher.connect();

  fetcher.close();

  expect(signals[0].aborted).toBe(true);
  expect(fetcher.connected).toBe(false);
  expect(await bytesOf(fetcher.getStream())).toEqual(new Uint8Array());
});

it('reports a missing resource', async () => {
  const fetcher = new CachedStreamFetcher('https://example.test/missing', {
    fetch: async () => new Response('gone', { status: 404 }),
  });
  await expect(fetcher.connect()).rejects.toThrow(
    'https://example.test/missing'
  );
  expect(fetcher.connected).toBe(false);
});
