import { Maybe } from '@/src/types';
import { Awaitable } from '@vueuse/core';

export type LoaderEvents = {
  error: any;
  done: any;
};

interface Loader {
  load(): Awaitable<void>;
  stop(): Awaitable<void>;
}

/**
 * A metadata loader.
 */
export interface MetaLoader extends Loader {
  meta: Maybe<Array<[string, string]>>;
  metaBlob: Maybe<Blob>;
}

/**
 * A data loader.
 */
export interface DataLoader extends Loader {
  data: Maybe<Blob>;
}

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
