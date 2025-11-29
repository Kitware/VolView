import {
  HTTP_STATUS_OK,
  HTTP_STATUS_PARTIAL_CONTENT,
  HTTP_STATUS_REQUESTED_RANGE_NOT_SATISFIABLE,
  HttpNotFound,
} from '@/src/core/streaming/httpCodes';
import { Fetcher, FetcherInit } from '@/src/core/streaming/types';
import {
  ContentRange,
  parseContentRangeHeader,
} from '@/src/utils/parseContentRangeHeader';
import { Maybe } from '@/src/types';

type FetchFunction = typeof fetch;

export interface CachedStreamFetcherRequestInit extends RequestInit {
  prefixChunks?: Uint8Array[];
  contentLength?: number;
  fetch?: FetchFunction;
}

export const StopSignal = Symbol('StopSignal');

export function sliceChunks(chunks: Uint8Array[], start: number) {
  const newChunks: Uint8Array[] = [];
  let size = 0;
  for (let i = 0; i < chunks.length && size < start; i++) {
    const chunk = chunks[i];
    if (size + chunk.length > start) {
      const offset = start - size;
      const newChunk = chunk.slice(0, offset);
      newChunks.push(newChunk);
      size += newChunk.length;
    } else {
      newChunks.push(chunk);
      size += chunk.length;
    }
  }
  return newChunks;
}

/**
 * Infers the content range from a full content length and a remaining content length.
 *
 * The remaining length is expected to be the length of the remaining bytes to
 * be downloaded.
 */
function inferContentRange(
  remainingLength: number | null,
  totalLength: number | null
): ContentRange {
  if (remainingLength == null || totalLength == null)
    return { type: 'empty-range' };

  if (remainingLength > totalLength) {
    return { type: 'invalid-range' };
  }

  const start = totalLength - remainingLength;
  const end = totalLength - 1;
  return { type: 'range', start, end, length: totalLength };
}

/**
 * A cached stream fetcher that caches a URI stream.
 *
 * Supports servers that accept Range requests.
 *
 * This fetcher falls back to downloading the entire stream if the server does
 * not support the Range header with bytes.
 */
export class CachedStreamFetcher implements Fetcher {
  private abortController: Maybe<AbortController>;
  private fetch: typeof fetch;
  private chunks: Uint8Array[];
  private contentLength: number | null = null;
  private activeNetworkStream: ReadableStream<Uint8Array> | null = null;
  private activeNetworkStreamReader: ReadableStreamDefaultReader<Uint8Array> | null =
    null;

  public contentType: string = '';
  public contentDisposition: string = '';

  constructor(
    private request: RequestInfo | URL,
    private init?: CachedStreamFetcherRequestInit
  ) {
    this.chunks = [...(init?.prefixChunks ?? [])];
    this.contentLength = init?.contentLength ?? null;
    this.fetch = init?.fetch ?? globalThis.fetch;
  }

  get connected() {
    return !!this.abortController;
  }

  get size() {
    return this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  }

  get cachedChunks() {
    return this.chunks;
  }

  get abortSignal() {
    return this.abortController?.signal;
  }

  async connect(init?: FetcherInit) {
    if (this.connected) return;

    this.abortController = init?.abortController ?? new AbortController();
    this.abortController.signal.addEventListener('abort', () => {
      this.cleanupAfterAbort();
    });

    // do not actually send the request, since we've cached the entire response
    if (this.size === this.contentLength) return;

    // Use fromEntries as a workaround to handle
    // jsdom not setting Range properly.
    const headers = Object.fromEntries(new Headers(this.init?.headers ?? {}));
    if (this.size > 0) {
      headers.Range = `bytes=${this.size}-`;
    }

    const response = await this.fetch(new Request(this.request), {
      ...this.init,
      headers,
      signal: this.abortController.signal,
    });

    this.contentType = response.headers.get('content-type') ?? '';
    this.contentDisposition = response.headers.get('content-disposition') ?? '';

    let remainingContentLength: number | null = null;
    if (response.headers.has('content-length')) {
      remainingContentLength = Number(response.headers.get('content-length'));
    }

    // set this.contentLength if we didn't submit a partial request
    if (
      this.size === 0 &&
      this.contentLength == null &&
      remainingContentLength != null
    ) {
      this.contentLength = remainingContentLength;
    }

    if (!response.body) throw new Error('Did not receive a response body');

    const noMoreContent = remainingContentLength === 0;
    // Content-Range needs to be in Access-Control-Expose-Headers. If not, then
    // try to infer based on the remaining content length and the total content
    // length.
    const contentRange = response.headers.has('content-range')
      ? parseContentRangeHeader(response.headers.get('content-range'))
      : inferContentRange(remainingContentLength, this.contentLength);
    const rangeNotSatisfiable =
      response.status === HTTP_STATUS_REQUESTED_RANGE_NOT_SATISFIABLE;

    if (rangeNotSatisfiable && !noMoreContent) {
      throw new Error('Range could not be satisfied');
    }

    if (
      !noMoreContent &&
      response.status !== HTTP_STATUS_OK &&
      response.status !== HTTP_STATUS_PARTIAL_CONTENT
    ) {
      throw new HttpNotFound(this.request.toString());
    }

    if (response.status === HTTP_STATUS_PARTIAL_CONTENT) {
      if (contentRange.type === 'invalid-range')
        throw new Error('Invalid content-range header');
      if (contentRange.type === 'unsatisfied-range')
        throw new Error('Range could not be satisfied');

      let start: number = 0;
      if (contentRange.type === 'range') {
        start = contentRange.start;
      }

      this.chunks = sliceChunks(this.chunks, start);
    } else if (!noMoreContent) {
      this.chunks = [];
    }

    this.activeNetworkStream = response.body;
    this.activeNetworkStreamReader = this.activeNetworkStream.getReader();
  }

  close() {
    if (!this.abortController) return;
    this.abortController.abort(StopSignal);
    this.cleanupAfterAbort();
  }

  getStream() {
    let chunkIndex = 0;
    return new ReadableStream({
      pull: async (controller) => {
        if (!this.connected) {
          controller.close();
        }

        if (chunkIndex > this.chunks.length)
          throw new Error('Did chunks get truncated?');

        if (chunkIndex === this.chunks.length) {
          const result = await this.readNextNetworkChunk();
          if (result.done) {
            controller.close();
            return;
          }
        }

        // invariant: chunkIndex < this.chunks.length
        controller.enqueue(this.chunks[chunkIndex++]);
      },
    });
  }

  private promise: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;

  private readNextNetworkChunk() {
    if (!this.activeNetworkStreamReader)
      return Promise.resolve<ReadableStreamReadDoneResult<Uint8Array>>({
        done: true,
        value: undefined,
      });

    if (!this.promise) {
      this.promise = this.activeNetworkStreamReader
        .read()
        .then((result) => {
          if (!result.done) {
            this.chunks.push(result.value);
          } else if (this.contentLength === null) {
            // Entire stream finished but had no Content-Length header; treat full cache as total length
            this.contentLength = this.size;
          }
          return result;
        })
        .finally(() => {
          this.promise = null;
        });
    }
    return this.promise;
  }

  async blob() {
    await this.connect();

    const stream = this.getStream();
    const sink = new WritableStream();
    await stream.pipeTo(sink);
    return new Blob(this.chunks, { type: this.contentType });
  }

  private cleanupAfterAbort() {
    this.activeNetworkStreamReader = null;
    this.activeNetworkStream = null;
    this.abortController = null;
  }
}
