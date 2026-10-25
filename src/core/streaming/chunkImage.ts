import type { ProgressiveImage } from '@/src/core/progressiveImage';
import type { Chunk, Reconstruction } from '@/packages/dicom/core';
import type { ChunkImageEvents, ChunkStatus } from '@/packages/dicom/vtk';

export type ChunkImage = ProgressiveImage & {
  setChunks(
    chunks: Chunk[],
    orientation: number[] | null,
    reconstruction?: Reconstruction
  ): Promise<void>;
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
