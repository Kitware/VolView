import { concatStreams } from '@/src/core/streaming/concatStreams';
import {
  HTTP_STATUS_OK,
  HTTP_STATUS_PARTIAL_CONTENT,
  HTTP_STATUS_REQUESTED_RANGE_NOT_SATISFIABLE,
  HttpNotFound,
} from '@/src/core/streaming/httpCodes';
import { Fetcher, FetcherInit } from '@/src/core/streaming/types';
import { Maybe } from '@/src/types';

type FetchFunction = typeof fetch;

export interface ResumableRequestInit extends RequestInit {
  prefixChunks?: Uint8Array[];
  contentLength?: number;
  fetch?: FetchFunction;
}

export const StopSignal = Symbol('StopSignal');

/**
 * A resumable fetcher that caches previously downloaded partial streams.
 *
 * This fetcher falls back to downloading the entire stream if the server does
 * not support the Range header with bytes.
 *
 * A new call to start() will stream the cached stream until empty, after which
 * the partial response is streamed.
 */
export class ResumableFetcher implements Fetcher {
  private abortController: Maybe<AbortController>;
  private fetch: typeof fetch;
  private chunks: Uint8Array[];
  private contentLength: number | null = null;
  private activeNetworkStream: ReadableStream<Uint8Array> | null = null;
  public contentType: string = '';

  constructor(
    private request: RequestInfo | URL,
    private init?: ResumableRequestInit
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
    this.abortController.signal.addEventListener('abort', () => this.cleanup());

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

    this.activeNetworkStream = this.wrapNetworkStream(response.body);
  }

  close() {
    if (!this.abortController) return;
    this.abortController.abort(StopSignal);
    this.cleanup();
  }

  getStream() {
    return concatStreams(this.getDataChunksAsStream(), this.getNetworkStream());
  }

  async blob() {
    const stream = this.getStream();
    const sink = new WritableStream();
    await stream.pipeTo(sink);
    return new Blob(this.chunks, { type: this.contentType });
  }

  private cleanup() {
    this.activeNetworkStream = null;
    this.abortController = null;
  }

  private getDataChunksAsStream() {
    let i = 0;
    const self = this;
    return new ReadableStream({
      pull(controller) {
        if (i < self.chunks.length) {
          controller.enqueue(self.chunks[i]);
          i += 1;
        } else {
          controller.close();
        }
      },
    });
  }

  private wrapNetworkStream(stream: ReadableStream<Uint8Array>) {
    const cacheChunkStream = new TransformStream({
      transform: (chunk, controller) => {
        this.chunks.push(chunk);
        controller.enqueue(chunk);
      },
    });

    return stream.pipeThrough(cacheChunkStream);
  }

  private getNetworkStream() {
    if (!this.activeNetworkStream) {
      return new ReadableStream();
    }
    const [s1, s2] = this.activeNetworkStream.tee();
    this.activeNetworkStream = s2;
    return s1;
  }
}
