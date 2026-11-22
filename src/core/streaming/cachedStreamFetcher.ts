import type { Fetcher } from '@/src/core/streaming/types';

type FetchFunction = typeof fetch;

export type CachedStreamFetcherRequestInit = RequestInit & {
  fetch?: FetchFunction;
};

export const StopSignal = Symbol('StopSignal');

/**
 * Downloads a URL once and replays what has arrived, from the start, to every
 * stream it hands out.
 */
export class CachedStreamFetcher implements Fetcher {
  private fetch: FetchFunction;
  private open = false;
  private request: AbortController | null = null;
  private chunks: Uint8Array<ArrayBuffer>[] = [];
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;

  public contentType = '';
  public contentDisposition = '';

  constructor(
    private url: RequestInfo | URL,
    private init?: CachedStreamFetcherRequestInit
  ) {
    const fetchFn = init?.fetch ?? globalThis.fetch;
    this.fetch = (input, options) => fetchFn(input, options);
  }

  get connected() {
    return this.open;
  }

  async connect() {
    if (this.open) return;
    this.open = true;
    this.chunks = [];
    const request = new AbortController();
    this.request = request;
    try {
      const response = await this.fetch(new Request(this.url), {
        ...this.init,
        signal: request.signal,
      });
      if (response.status !== 200)
        throw new Error(`HTTP ${response.status} for ${this.url}`);
      if (!response.body) throw new Error('Did not receive a response body');
      this.contentType = response.headers.get('content-type') ?? '';
      this.contentDisposition =
        response.headers.get('content-disposition') ?? '';
      this.reader = response.body.getReader();
    } catch (error) {
      this.close();
      throw error;
    }
  }

  close() {
    this.open = false;
    this.release();
  }

  getStream() {
    let index = 0;
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        if (
          !this.open ||
          (index === this.chunks.length && (await this.readNext()).done)
        ) {
          controller.close();
          return;
        }
        controller.enqueue(this.chunks[index++]);
      },
    });
  }

  async blob() {
    await this.connect();
    await this.getStream().pipeTo(new WritableStream());
    return new Blob(this.chunks, { type: this.contentType });
  }

  // A pooled fetch holds its request until the caller's signal aborts.
  private release() {
    this.reader = null;
    this.request?.abort(StopSignal);
    this.request = null;
  }

  private readNext() {
    const { reader } = this;
    if (!reader)
      return Promise.resolve<ReadableStreamReadDoneResult<Uint8Array>>({
        done: true,
        value: undefined,
      });
    this.pending ??= reader
      .read()
      .then((result) => {
        if (result.done) this.release();
        else this.chunks.push(result.value as Uint8Array<ArrayBuffer>);
        return result;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }
}
