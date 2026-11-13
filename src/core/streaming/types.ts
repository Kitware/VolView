/**
 * Init options for a Fetcher.
 */
export type FetcherInit = {
  abortController?: AbortController;
};

/**
 * A source of bytes that can be streamed from the start or taken whole.
 */
export type Fetcher = {
  connect(): Promise<void>;
  getStream(): ReadableStream<Uint8Array>;
  blob(): Promise<Blob>;
  close(): void;
  connected: boolean;
  size: number;
  contentType?: string;
  abortSignal?: AbortSignal;
};
