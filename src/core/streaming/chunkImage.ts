import { Chunk } from '@/src/core/streaming/chunk';
import { Extent } from '@kitware/vtk.js/types';
import { Ref } from 'vue';

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
  chunkLoaded: ChunkLoadedInfo;
  chunkErrored: ChunkErrorInfo;
};

export interface ChunkImage {
  addChunks(chunks: Chunk[]): void;
  startLoad(): void;
  stopLoad(): void;
  dispose(): void;
  getThumbnail(strategy: ThumbnailStrategy): Promise<string>;
  addEventListener<T extends keyof ChunkImageEvents>(
    type: T,
    callback: (info: ChunkImageEvents[T]) => void
  ): void;
  removeEventListener<T extends keyof ChunkImageEvents>(
    type: T,
    callback: (info: ChunkImageEvents[T]) => void
  ): void;
  isLoading: Ref<boolean>;
  chunkStatus: Ref<Array<ChunkStatus>>;
}
