import { describe, expect, it } from 'vitest';
import { fromBlob, fromUrl, type ByteRange } from '../byteSource';
import { concatBytes } from '../../utils';

const readStream = async (stream: ReadableStream<Uint8Array>) => {
  const parts: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return concatBytes(parts);
    parts.push(value);
  }
};

const bytes = Uint8Array.from({ length: 1000 }, (_, index) => index % 251);
const expected = (range?: ByteRange) =>
  bytes.slice(range?.start ?? 0, range?.end ?? bytes.length);

type ServerOptions = {
  honorRange?: boolean;
  exposeContentRange?: boolean;
  status?: number;
};

/** A fetch that serves `bytes` in 64-byte chunks and records what it was asked. */
const server = (options: ServerOptions = {}) => {
  const { honorRange = true, exposeContentRange = true, status } = options;
  const requests: Array<string | null> = [];
  const caches: Array<RequestCache | undefined> = [];
  const bodies: Array<{ cancelled: boolean }> = [];
  const fetchFn: typeof fetch = async (_input, init) => {
    const range = new Headers(init?.headers).get('Range');
    requests.push(range);
    caches.push(init?.cache);
    const match = range?.match(/^bytes=(\d+)-(\d*)$/);
    const partial = honorRange && match !== null && match !== undefined;
    const start = partial ? Number(match[1]) : 0;
    const end = partial && match[2] ? Number(match[2]) + 1 : bytes.length;
    const body = { cancelled: false };
    bodies.push(body);
    let offset = start;
    const stream = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        if (offset >= end) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(offset, Math.min(end, offset + 64)));
        offset += 64;
      },
      cancel: () => {
        body.cancelled = true;
      },
    });
    const headers = new Headers({ 'content-length': String(end - start) });
    if (partial && exposeContentRange)
      headers.set('content-range', `bytes ${start}-${end - 1}/${bytes.length}`);
    return new Response(stream, {
      status: status ?? (partial ? 206 : 200),
      headers,
    });
  };
  return { fetch: fetchFn, requests, caches, bodies };
};

const signal = () => new AbortController().signal;

describe('blob byte source', () => {
  it.each([
    undefined,
    { start: 10, end: 20 },
    { start: 990 },
    { start: 5, end: 5000 },
  ])('reads %j', async (range) => {
    const source = fromBlob(new Blob([bytes]));
    expect(source.size).toBe(bytes.length);
    expect(await readStream(source.read(signal(), range))).toEqual(
      expected(
        range && {
          ...range,
          end: Math.min(range.end ?? bytes.length, bytes.length),
        }
      )
    );
  });

  it('errors its stream once the signal aborts', async () => {
    const controller = new AbortController();
    const stream = fromBlob(new Blob([bytes])).read(controller.signal);
    controller.abort(new DOMException('stop', 'AbortError'));
    await expect(readStream(stream)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});

describe('URL byte source', () => {
  it('reads the whole resource without a Range header', async () => {
    const http = server();
    const source = fromUrl('https://example.test/a.dcm', { fetch: http.fetch });
    expect(await readStream(source.read(signal()))).toEqual(bytes);
    expect(http.requests).toEqual([null]);
  });

  it.each([
    ['exposes Content-Range', { exposeContentRange: true }],
    ['hides Content-Range from CORS', { exposeContentRange: false }],
    ['ignores Range and answers 200', { honorRange: false }],
  ])('reads a range when the server %s', async (_name, options) => {
    const http = server(options);
    const source = fromUrl('https://example.test/a.dcm', { fetch: http.fetch });

    const bounded = await readStream(
      source.read(signal(), { start: 100, end: 300 })
    );
    const open = await readStream(source.read(signal(), { start: 900 }));

    expect(bounded).toEqual(expected({ start: 100, end: 300 }));
    expect(open).toEqual(expected({ start: 900 }));
    expect(http.requests).toEqual(['bytes=100-299', 'bytes=900-']);
  });

  it.each([
    [true, 'honoured'],
    [false, 'ignored'],
  ])(
    'reports a server that honours Range (%s) as %s, bypassing the HTTP cache for ranges',
    async (honorRange, support) => {
      const http = server({ honorRange });
      const source = fromUrl('https://example.test/a.dcm', {
        fetch: http.fetch,
      });
      expect(source.rangeSupport?.()).toBe('unknown');
      await readStream(source.read(signal()));
      expect(source.rangeSupport?.()).toBe('unknown');
      await readStream(source.read(signal(), { start: 10, end: 20 }));
      expect(source.rangeSupport?.()).toBe(support);
      expect(http.caches).toEqual([undefined, 'no-store']);
    }
  );

  it('stops the ignored-Range body once the range is read', async () => {
    const http = server({ honorRange: false });
    const source = fromUrl('https://example.test/a.dcm', { fetch: http.fetch });
    await readStream(source.read(signal(), { start: 0, end: 10 }));
    expect(http.bodies[0].cancelled).toBe(true);
  });

  it('opens a fresh request for every read', async () => {
    const http = server();
    const source = fromUrl('https://example.test/a.dcm', { fetch: http.fetch });
    await readStream(source.read(signal(), { start: 0, end: 4 }));
    await readStream(source.read(signal(), { start: 0, end: 4 }));
    expect(http.requests).toHaveLength(2);
  });

  it.each([
    [404, /could not be found/],
    [416, /Range could not be satisfied/],
  ])('fails a %i response', async (status, message) => {
    const http = server({ status });
    const source = fromUrl('https://example.test/a.dcm', { fetch: http.fetch });
    await expect(
      readStream(source.read(signal(), { start: 0, end: 4 }))
    ).rejects.toThrow(message);
  });

  it('cancels the response body when the reader cancels', async () => {
    const http = server();
    const source = fromUrl('https://example.test/a.dcm', { fetch: http.fetch });
    const reader = source.read(signal()).getReader();
    await reader.read();
    await reader.cancel();
    expect(http.bodies[0].cancelled).toBe(true);
  });
});
