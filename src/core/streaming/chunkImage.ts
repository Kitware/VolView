import {
  ProgressiveImage,
  ProgressiveImageEvents,
} from '@/src/core/progressiveImage';
import { Chunk } from '@/src/core/streaming/chunk';
import { Extent } from '@kitware/vtk.js/types';

export enum ThumbnailStrategy {
  MiddleSlice,
}

export enum ChunkStatus {
  NotLoaded,
  Loading,
  Loaded,
  Errored,
}

export interface ChunkLoadedInfo {
  updatedExtent: Extent;
  chunk: Chunk;
}

export interface ChunkErrorInfo {
  error: unknown;
  chunk: Chunk;
}

export type ChunkImageEvents = {
  chunkLoad: ChunkLoadedInfo;
  chunkError: ChunkErrorInfo;
} & ProgressiveImageEvents;

export interface ChunkImage extends ProgressiveImage {
  addChunks(chunks: Chunk[]): void;
  getThumbnail(strategy: ThumbnailStrategy): Promise<string>;
  addEventListener<T extends keyof ChunkImageEvents>(
    type: T,
    callback: (info: ChunkImageEvents[T]) => void
  ): void;
  removeEventListener<T extends keyof ChunkImageEvents>(
    type: T,
    callback: (info: ChunkImageEvents[T]) => void
  ): void;
  getChunkStatuses(): Array<ChunkStatus>;
}
