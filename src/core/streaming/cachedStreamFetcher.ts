import {
  HTTP_STATUS_OK,
  HTTP_STATUS_PARTIAL_CONTENT,
  HTTP_STATUS_REQUESTED_RANGE_NOT_SATISFIABLE,
  HttpNotFound,
} from '@/src/core/streaming/httpCodes';
import { Fetcher, FetcherInit } from '@/src/core/streaming/types';
import { Maybe } from '@/src/types';

type FetchFunction = typeof fetch;

export interface CachedStreamFetcherRequestInit extends RequestInit {
  prefixChunks?: Uint8Array[];
  contentLength?: number;
  fetch?: FetchFunction;
}

export const StopSignal = Symbol('StopSignal');

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

    if (this.size === 0 && response.headers.has('content-length')) {
      this.contentLength = Number(response.headers.get('content-length')!);
    }

    if (!response.body) throw new Error('Did not receive a response body');

    const noMoreContent = response.headers.get('content-length') === '0';
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
      throw new HttpNotFound();
    }

    if (!noMoreContent && response.status !== HTTP_STATUS_PARTIAL_CONTENT) {
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
