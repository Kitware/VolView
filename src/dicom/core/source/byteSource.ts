import { concatBytes, linkedController } from '../utils';
import { parseContentRangeHeader } from './parseContentRangeHeader';

const HTTP_STATUS_OK = 200;
const HTTP_STATUS_PARTIAL_CONTENT = 206;
const HTTP_STATUS_REQUESTED_RANGE_NOT_SATISFIABLE = 416;

/** Half-open byte interval; an absent end reads to the last byte. */
export type ByteRange = { start: number; end?: number };

/**
 * Where an instance's bytes come from. Every read opens a fresh stream that
 * the signal or a cancel closes; nothing stays open or cached between reads.
 */
export type ByteSource = {
  read: (signal: AbortSignal, range?: ByteRange) => ReadableStream<Uint8Array>;
  /**
   * Whether a ranged read costs only its range. Absent means it does; a
   * source that learns it from responses says `unknown` until one arrives.
   */
  rangeSupport?: () => RangeSupport;
};

export type RangeSupport = 'unknown' | 'honored' | 'ignored';

/** Enough that a header rarely needs a second slice. */
const OPEN_READ_FIRST_SLICE = 64 * 1024;

const rangeLength = (range?: ByteRange) =>
  range?.end === undefined ? Infinity : Math.max(0, range.end - range.start);

export const fromBlob = (blob: Blob): ByteSource => ({
  read: (signal, range) => {
    let offset = range?.start ?? 0;
    const end = Math.min(blob.size, offset + rangeLength(range));
    // Every slice costs a turn of the calling thread. A range with an end is
    // wanted whole; an open read may stop early, so it starts small and doubles.
    let step = range?.end === undefined ? OPEN_READ_FIRST_SLICE : end - offset;
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        signal.throwIfAborted();
        if (offset >= end) {
          controller.close();
          return;
        }
        const next = Math.min(end, offset + step);
        step *= 2;
        const bytes = new Uint8Array(
          await blob.slice(offset, next).arrayBuffer()
        );
        signal.throwIfAborted();
        offset = next;
        controller.enqueue(bytes);
      },
    });
  },
});

/** Drops `skip` leading bytes and stops after `length` bytes. */
function sliceStream(
  stream: ReadableStream<Uint8Array>,
  skip: number,
  length = Infinity
) {
  const reader = stream.getReader();
  let toSkip = skip;
  let remaining = length;
  // A pull that enqueues nothing is not called again, so skip inside one pull.
  const nextKept = async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return null;
      const dropped = Math.min(toSkip, value.length);
      toSkip -= dropped;
      if (dropped < value.length)
        return value.subarray(dropped, dropped + remaining);
    }
  };
  return new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      const kept = remaining > 0 ? await nextKept() : null;
      if (!kept) {
        controller.close();
        reader.cancel().catch(() => {});
        return;
      }
      remaining -= kept.length;
      controller.enqueue(kept);
    },
    cancel: (reason) => reader.cancel(reason),
  });
}

const rangeHeader = ({ start, end }: ByteRange) =>
  `bytes=${start}-${end === undefined ? '' : end - 1}`;

// Content-Range is often not CORS-exposed; a 206 without it starts where asked.
function partialContentStart(response: Response, range: ByteRange) {
  const contentRange = parseContentRangeHeader(
    response.headers.get('content-range')
  );
  if (contentRange.type === 'empty-range') return range.start;
  if (contentRange.type !== 'range')
    throw new Error('Invalid content-range header');
  if (contentRange.start > range.start)
    throw new Error('The server answered a range that starts too late');
  return contentRange.start;
}

function rangedBody(response: Response, range?: ByteRange) {
  if (!response.body) throw new Error('Did not receive a response body');
  const start = range?.start ?? 0;
  const bodyStart =
    response.status === HTTP_STATUS_PARTIAL_CONTENT && range
      ? partialContentStart(response, range)
      : 0;
  return sliceStream(response.body, start - bodyStart, rangeLength(range));
}

type UrlSourceOptions = {
  fetch?: typeof fetch;
};

function assertReadableStatus(response: Response, url: string | URL) {
  if (
    response.status === HTTP_STATUS_OK ||
    response.status === HTTP_STATUS_PARTIAL_CONTENT
  )
    return;
  response.body?.cancel().catch(() => {});
  if (response.status === HTTP_STATUS_REQUESTED_RANGE_NOT_SATISFIABLE)
    throw new Error('Range could not be satisfied');
  throw new Error(`HTTP ${response.status} for ${url}`);
}

/**
 * Asks for a range with an HTTP Range request. A server that ignores Range
 * answers 200 with the whole body, which is then skipped and cut to size;
 * `rangeSupport` reports what the latest ranged response showed.
 */
export const fromUrl = (
  url: string | URL,
  options: UrlSourceOptions = {}
): ByteSource => {
  const fetchFn =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  let rangeSupport: RangeSupport = 'unknown';
  const open = async (signal: AbortSignal, range?: ByteRange) => {
    // Chrome can answer a Range from a cache entry an earlier cancelled read
    // left behind with status 200 and only the range's bytes, which reads
    // exactly like a server that ignored Range.
    const ranged = range
      ? { cache: 'no-store' as const, headers: { Range: rangeHeader(range) } }
      : {};
    const response = await fetchFn(url, { ...ranged, signal });
    assertReadableStatus(response, url);
    if (range)
      rangeSupport =
        response.status === HTTP_STATUS_PARTIAL_CONTENT ? 'honored' : 'ignored';
    return rangedBody(response, range).getReader();
  };
  return {
    rangeSupport: () => rangeSupport,
    read: (signal, range) => {
      const { controller } = linkedController(signal);
      const opened = open(controller.signal, range);
      // Abort is how a pooled fetch learns it is done, failed reads included.
      const abort = () => controller.abort();
      // Observed here so a stream nobody pulls does not reject unhandled.
      opened.catch(abort);
      const pull = async (
        stream: ReadableStreamDefaultController<Uint8Array>
      ) => {
        const { done, value } = await (await opened).read();
        if (!done) {
          stream.enqueue(value);
          return;
        }
        abort();
        stream.close();
      };
      return new ReadableStream<Uint8Array>({
        pull: (stream) =>
          pull(stream).catch((error) => {
            abort();
            throw error;
          }),
        cancel: async (reason) => {
          controller.abort(reason);
          const reader = await opened.catch(() => null);
          await reader?.cancel(reason);
        },
      });
    },
  };
};

/** Reads a whole source, or one range of it, into memory. */
export async function readBytes(
  source: ByteSource,
  signal: AbortSignal,
  range?: ByteRange
) {
  const reader = source.read(signal, range).getReader();
  const cancel = () => reader.cancel(signal.reason).catch(() => {});
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const parts: Uint8Array[] = [];
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    signal.throwIfAborted();
    return concatBytes(parts);
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
