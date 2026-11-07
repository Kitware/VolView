import type { ProgressiveImage } from '@/src/core/progressiveImage';
import type { Chunk } from '@/packages/dicom/core/streaming/chunk';
import type { Reconstruction } from '@/packages/dicom/core/collections/reconstructVolume';
import type { ChunkImageEvents, ChunkStatus } from '@/packages/dicom/vtk/types';

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
