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
  /** Moves the start of the range the server answers away from the one asked. */
  startShift?: number;
  contentRange?: string;
};

/** The span a server answers a Range header with, or null for the whole body. */
const answeredSpan = (
  range: string | null,
  { honorRange = true, startShift = 0 }: ServerOptions
) => {
  const match = range?.match(/^bytes=(\d+)-(\d*)$/);
  if (!honorRange || !match) return null;
  return {
    start: Number(match[1]) + startShift,
    end: match[2] ? Number(match[2]) + 1 : bytes.length,
  };
};

/** `bytes[start, end)` in 64-byte chunks, flagging `body` when cancelled. */
const chunkedBody = (
  start: number,
  end: number,
  body: { cancelled: boolean }
) => {
  let offset = start;
  return new ReadableStream<Uint8Array>({
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
};

/** A fetch that serves `bytes` and records what it was asked. */
const server = (options: ServerOptions = {}) => {
  const { exposeContentRange = true, status, contentRange } = options;
  const requests: Array<string | null> = [];
  const caches: Array<RequestCache | undefined> = [];
  const signals: Array<AbortSignal | null | undefined> = [];
  const bodies: Array<{ cancelled: boolean }> = [];
  const fetchFn: typeof fetch = async (_input, init = {}) => {
    const range = new Headers(init.headers).get('Range');
    requests.push(range);
    caches.push(init.cache);
    signals.push(init.signal);
    const span = answeredSpan(range, options);
    const { start, end } = span ?? { start: 0, end: bytes.length };
    const body = { cancelled: false };
    bodies.push(body);
    const headers = new Headers({ 'content-length': String(end - start) });
    if (span && exposeContentRange)
      headers.set(
        'content-range',
        contentRange ?? `bytes ${start}-${end - 1}/${bytes.length}`
      );
    return new Response(chunkedBody(start, end, body), {
      status: status ?? (span ? 206 : 200),
      headers,
    });
  };
  return { fetch: fetchFn, requests, caches, bodies, signals };
};

const urlSource = (options?: ServerOptions) => {
  const http = server(options);
  return {
    http,
    source: fromUrl('https://example.test/a.dcm', { fetch: http.fetch }),
  };
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

  it('hands a range with an end over whole and an open read in growing slices', async () => {
    const large = new Blob([new Uint8Array(500 * 1024)]);
    const chunkSizes = async (range?: ByteRange) => {
      const reader = fromBlob(large).read(signal(), range).getReader();
      const sizes: number[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return sizes;
        sizes.push(value.length);
      }
    };
    expect(await chunkSizes({ start: 1024, end: 401 * 1024 })).toEqual([
      400 * 1024,
    ]);
    expect(await chunkSizes()).toEqual([
      64 * 1024,
      128 * 1024,
      256 * 1024,
      52 * 1024,
    ]);
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
    const { http, source } = urlSource();
    expect(await readStream(source.read(signal()))).toEqual(bytes);
    expect(http.requests).toEqual([null]);
  });

  it.each([
    ['exposes Content-Range', { exposeContentRange: true }],
    ['hides Content-Range from CORS', { exposeContentRange: false }],
    ['ignores Range and answers 200', { honorRange: false }],
  ])('reads a range when the server %s', async (_name, options) => {
    const { http, source } = urlSource(options);

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
      const { http, source } = urlSource({ honorRange });
      expect(source.rangeSupport?.()).toBe('unknown');
      await readStream(source.read(signal()));
      expect(source.rangeSupport?.()).toBe('unknown');
      await readStream(source.read(signal(), { start: 10, end: 20 }));
      expect(source.rangeSupport?.()).toBe(support);
      expect(http.caches).toEqual([undefined, 'no-store']);
    }
  );

  it('stops the ignored-Range body once the range is read', async () => {
    const { http, source } = urlSource({ honorRange: false });
    await readStream(source.read(signal(), { start: 0, end: 10 }));
    expect(http.bodies[0].cancelled).toBe(true);
  });

  it('opens a fresh request for every read', async () => {
    const { http, source } = urlSource();
    await readStream(source.read(signal(), { start: 0, end: 4 }));
    await readStream(source.read(signal(), { start: 0, end: 4 }));
    expect(http.requests).toHaveLength(2);
  });

  it('reads a range from a 206 that starts before it', async () => {
    const { source } = urlSource({ startShift: -50 });
    expect(
      await readStream(source.read(signal(), { start: 100, end: 300 }))
    ).toEqual(expected({ start: 100, end: 300 }));
  });

  it.each([
    ['starts after the range asked', { startShift: 50 }, /starts too late/],
    [
      'carries an unreadable Content-Range',
      { contentRange: 'bytes 100-' },
      /Invalid content-range/,
    ],
  ])('fails a 206 that %s', async (_name, options, message) => {
    const { source } = urlSource(options);
    await expect(
      readStream(source.read(signal(), { start: 100, end: 300 }))
    ).rejects.toThrow(message);
  });

  it('aborts its request once the body is read to the end', async () => {
    const { http, source } = urlSource();
    await readStream(source.read(signal(), { start: 0, end: 10 }));
    expect(http.signals[0]?.aborted).toBe(true);
  });

  it.each([
    [401, /HTTP 401/],
    [404, /HTTP 404/],
    [500, /HTTP 500/],
    [416, /Range could not be satisfied/],
  ])('fails a %i response', async (status, message) => {
    const { source } = urlSource({ status });
    await expect(
      readStream(source.read(signal(), { start: 0, end: 4 }))
    ).rejects.toThrow(message);
  });

  it.each([
    ['answers 404', { status: 404 }],
    ['answers a 206 that starts late', { startShift: 50 }],
    ['answers an unreadable Content-Range', { contentRange: 'bytes 100-' }],
  ])('aborts its request when the server %s', async (_name, options) => {
    const { http, source } = urlSource(options);
    await expect(
      readStream(source.read(signal(), { start: 100, end: 300 }))
    ).rejects.toThrow();
    expect(http.signals[0]?.aborted).toBe(true);
  });

  it('aborts its request when the body fails partway', async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    const failing: typeof fetch = async (_input, init = {}) => {
      signals.push(init.signal);
      return new Response(
        new ReadableStream({
          pull: () => Promise.reject(new Error('connection reset')),
        })
      );
    };
    const source = fromUrl('https://example.test/a.dcm', { fetch: failing });
    await expect(readStream(source.read(signal()))).rejects.toThrow(
      'connection reset'
    );
    expect(signals[0]?.aborted).toBe(true);
  });

  it('cancels the response body when the reader cancels', async () => {
    const { http, source } = urlSource();
    const reader = source.read(signal()).getReader();
    await reader.read();
    await reader.cancel();
    expect(http.bodies[0].cancelled).toBe(true);
  });
});
