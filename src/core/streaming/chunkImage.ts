import { Chunk } from '@/src/core/streaming/chunk';
import { Ref } from 'vue';

export enum ThumbnailStrategy {
  MiddleSlice,
}

export interface ChunkImage {
  addChunks(chunks: Chunk[]): void;
  startLoad(): void;
  stopLoad(): void;
  dispose(): void;
  getThumbnail(strategy: ThumbnailStrategy): Promise<string>;
  isLoading: Ref<boolean>;
}
