/**
 * Init options for a Fetcher.
 */
export interface FetcherInit {
  abortController?: AbortController;
}

/**
 * A fetcher that caches an incoming stream.
 */
export interface Fetcher {
  connect(): Promise<void>;
  getStream(): ReadableStream<Uint8Array>;
  blob(): Promise<Blob>;
  close(): void;
  cachedChunks: Uint8Array[];
  connected: boolean;
  size: number;
  abortSignal?: AbortSignal;
}
