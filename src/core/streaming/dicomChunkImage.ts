import { VtkDicomImage } from '@/packages/dicom/vtk/VtkDicomImage';
import {
  type VtkDicomImageInit,
  type ChunkImageEvents,
} from '@/packages/dicom/vtk/types';
import type { Chunk } from '@/packages/dicom/core/streaming/chunk';
import type { Reconstruction } from '@/packages/dicom/core/collections/reconstructVolume';
import { BaseProgressiveImage } from '@/src/core/progressiveImage';
import type { ChunkImage } from '@/src/core/streaming/chunkImage';
import {
  readDicomSegmentation,
  type ReadOverlappingSegmentationMeta,
} from '@/src/io/dicom';
import type { JsonCompatible } from '@itk-wasm/image-io';
import { useDicomRuntimeStore } from '@/src/store/dicom-runtime';
import { convertItkToVtkImage } from '@/src/io/convertItkToVtkImage';
import { surfaceWarning } from '@/src/store/messages';
import { computed } from 'vue';

export type DicomChunkImageInit = VtkDicomImageInit;

/** Vue state and application decoding policy for the reusable vtk consumer. */
export default class DicomChunkImage
  extends BaseProgressiveImage
  implements ChunkImage
{
  private readonly consumer: VtkDicomImage;

  constructor(init: Partial<DicomChunkImageInit> = {}) {
    super();
    this.consumer = new VtkDicomImage({
      ...init,
      readDicomImage:
        init.readDicomImage ?? useDicomRuntimeStore().loader.readDicomImage,
      warn: init.warn ?? surfaceWarning,
      readSegmentation:
        init.readSegmentation ??
        (async (file) => {
          const result = await readDicomSegmentation(file);
          return {
            image: convertItkToVtkImage(result.outputImage),
            metadata: result.metaInfo,
          };
        }),
    });
    this.vtkImageData.value.delete();
    this.vtkImageData.value = this.consumer.getVtkImageData();
    this.loaded = computed(
      () => !this.loading.value && this.status.value === 'complete'
    );
    this.consumer.addEventListener('imageChanged', (image) => {
      this.spatialMetadata.value = this.consumer.getSpatialMetadata();
      this.vtkImageData.value = image;
    });
    this.consumer.addEventListener('status', (status) => {
      this.status.value = status;
    });
    this.consumer.addEventListener('loading', (loading) => {
      this.loading.value = loading;
    });
  }

  get segBuildInfo() {
    return this.consumer.segmentationMetadata as
      | (JsonCompatible & ReadOverlappingSegmentationMeta)
      | null;
  }

  getModality() {
    return this.consumer.getModality();
  }

  getChunkStatuses() {
    return this.consumer.getChunkStatuses();
  }

  getOrientation() {
    return this.consumer.getOrientation();
  }

  getReconstruction() {
    return this.consumer.getReconstruction();
  }

  getChunks() {
    return this.consumer.getChunks();
  }

  getThumbnail() {
    return this.consumer.getThumbnail();
  }

  startLoad() {
    this.consumer.startLoad();
  }

  stopLoad() {
    this.consumer.stopLoad();
  }

  setChunks(
    chunks: Chunk[],
    orientation: number[] | null,
    reconstruction?: Reconstruction
  ) {
    return this.consumer.setChunks(chunks, orientation, reconstruction);
  }

  prepareChunks(
    chunks: Chunk[],
    orientation: number[] | null,
    reconstruction?: Reconstruction
  ) {
    return this.consumer.prepareChunks(chunks, orientation, reconstruction);
  }

  addEventListener<T extends keyof ChunkImageEvents>(
    type: T,
    callback: (info: ChunkImageEvents[T]) => void
  ) {
    this.consumer.addEventListener(type, callback);
  }

  removeEventListener<T extends keyof ChunkImageEvents>(
    type: T,
    callback: (info: ChunkImageEvents[T]) => void
  ) {
    this.consumer.removeEventListener(type, callback);
  }

  dispose() {
    super.dispose();
    this.consumer.dispose();
  }
}
