import {
  ProgressiveImage,
  ProgressiveImageEvents,
} from '@/src/core/progressiveImage';
import { Chunk } from '@/src/core/streaming/chunk';
import { Extent } from '@kitware/vtk.js/types';

export enum ChunkStatus {
  NotLoaded,
  Loading,
  Loaded,
  Errored,
}

export type ChunkLoadedInfo = {
  updatedExtent: Extent;
  chunk: Chunk;
};

export type ChunkErrorInfo = {
  error: unknown;
  chunk: Chunk;
};

export type ChunkImageEvents = {
  chunkLoad: ChunkLoadedInfo;
  chunkError: ChunkErrorInfo;
} & ProgressiveImageEvents;

export type ChunkImage = ProgressiveImage & {
  addChunks(chunks: Chunk[]): void;
  addEventListener<T extends keyof ChunkImageEvents>(
    type: T,
    callback: (info: ChunkImageEvents[T]) => void
  ): void;
  removeEventListener<T extends keyof ChunkImageEvents>(
    type: T,
    callback: (info: ChunkImageEvents[T]) => void
  ): void;
  getChunkStatuses(): Array<ChunkStatus>;
};
