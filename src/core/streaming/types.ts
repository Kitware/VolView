import { Maybe } from '@/src/types';
import { Awaitable } from '@vueuse/core';
import type { UltrasoundRegions } from '@/src/core/streaming/dicom/ultrasoundRegion';

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
  ultrasoundRegions?: UltrasoundRegions;
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
 * A source of bytes that can be streamed from the start or taken whole.
 */
export interface Fetcher {
  connect(): Promise<void>;
  getStream(): ReadableStream<Uint8Array>;
  blob(): Promise<Blob>;
  close(): void;
  /**
   * What the streams have delivered so far, kept by a fetcher whose source
   * has to be cached to be read again. A fetcher over addressable bytes keeps
   * none.
   */
  cachedChunks?: Uint8Array<ArrayBuffer>[];
  connected: boolean;
  size: number;
  contentType?: string;
  abortSignal?: AbortSignal;
}
