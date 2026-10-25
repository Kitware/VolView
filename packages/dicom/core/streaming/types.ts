import { Maybe } from '../utils';
import type { DicomDataset } from '../metadata/dicomDataset';
import type { DicomLayout } from '../metadata/dicomLayout';
import { Awaitable } from '../utils';
import type { UltrasoundRegions } from './dicom/ultrasoundRegion';

export type LoaderEvents = {
  error: any;
  done: any;
};

type Loader = {
  load(): Awaitable<void>;
  stop(): Awaitable<void>;
  dispose?(): void;
};

/**
 * A metadata loader.
 */
export type MetaLoader = Loader & {
  meta: Maybe<DicomDataset>;
  ultrasoundRegions?: UltrasoundRegions;
  fileLayout?: DicomLayout | null;
};

/**
 * A data loader.
 */
export type DataLoader = Loader & {
  data: Maybe<Blob>;
};

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
};
