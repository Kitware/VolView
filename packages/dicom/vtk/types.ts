import type { Image } from '@itk-wasm/image-io';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { Extent } from '@kitware/vtk.js/types';
import type { Chunk, DicomDataset } from '../core/index';
import type { IrregularGeometryPolicy } from './allocateImageFromChunks';
import type { ThumbnailSlice } from './thumbnail';

export enum ChunkStatus {
  NotLoaded,
  Loading,
  Loaded,
  Errored,
}

export type ProgressiveImageStatus = 'complete' | 'incomplete';
export type ChunkLoadedInfo = { updatedExtent: Extent; chunk: Chunk };
export type ChunkErrorInfo = { error: unknown; chunk: Chunk };
export type ChunkImageEvents = {
  chunkLoad: ChunkLoadedInfo;
  chunkError: ChunkErrorInfo;
  imageChanged: vtkImageData;
  status: ProgressiveImageStatus;
  loading: boolean;
  error: Error;
};

export type VtkDicomImageInit = {
  /** Decoded buffers are borrowed for one write, never retained or transferred. */
  readDicomImage: (
    file: File,
    metadata?: DicomDataset
  ) => Promise<{
    image: Pick<Image, 'size' | 'data'> & {
      imageType: Pick<Image['imageType'], 'components'>;
    };
  }>;
  /** A returned image becomes owned by this consumer, including stale results. */
  readSegmentation?: (file: File) => Promise<{
    image: vtkImageData;
    metadata: unknown;
  }>;
  encodeThumbnail?: (slice: ThumbnailSlice) => string;
  warn?: (title: string, details: string) => void;
  irregularGeometry?: IrregularGeometryPolicy;
};

export type DecodedChunkImage = Awaited<
  ReturnType<VtkDicomImageInit['readDicomImage']>
>['image'];
