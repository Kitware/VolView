import {
  buildSegmentGroups,
  ReadOverlappingSegmentationMeta,
  readVolumeSlice,
  splitAndSort,
} from '@/src/io/dicom';
import { Chunk, waitForChunkState } from '@/src/core/streaming/chunk';
import { Image, JsonCompatible, readImage } from '@itk-wasm/image-io';
import { getWorker } from '@/src/io/itk/worker';
import { allocateImageFromChunks } from '@/src/utils/allocateImageFromChunks';
import { TypedArray } from '@kitware/vtk.js/types';
import { Tags } from '@/src/core/dicomTags';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { ChunkState } from '@/src/core/streaming/chunkStateMachine';
import {
  type ChunkImage,
  ThumbnailStrategy,
  ChunkStatus,
  ChunkImageEvents,
} from '@/src/core/streaming/chunkImage';
import mitt, { Emitter } from 'mitt';
import {
  BaseProgressiveImage,
  ProgressiveImageStatus,
} from '@/src/core/progressiveImage';
import { ensureError } from '@/src/utils';
import { computed } from 'vue';
import vtkITKHelper from '@kitware/vtk.js/Common/DataModel/ITKHelper';

const { fastComputeRange } = vtkDataArray;

const DATA_RANGE_KEY = 'pixel-data-range';

function getChunkId(chunk: Chunk) {
  const metadata = Object.fromEntries(chunk.metadata!);
  const SOPInstanceUID = metadata[Tags.SOPInstanceUID];
  return SOPInstanceUID;
}

// Assume itkImage type is Uint8Array
function itkImageToURI(itkImage: Image) {
  const [width, height] = itkImage.size;
  const im = new ImageData(width, height);
  const arr32 = new Uint32Array(im.data.buffer);
  const itkBuf = itkImage.data;
  if (!itkBuf) {
    return '';
  }

  for (let i = 0; i < itkBuf.length; i += 1) {
    const byte = itkBuf[i] as number;
    // ABGR order
    // eslint-disable-next-line no-bitwise
    arr32[i] = (255 << 24) | (byte << 16) | (byte << 8) | byte;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.putImageData(im, 0, 0);
    return canvas.toDataURL('image/png');
  }
  return '';
}

async function dicomSliceToImageUri(blob: Blob) {
  const file = new File([blob], 'file.dcm');
  const itkImage = await readVolumeSlice(file, true);
  return itkImageToURI(itkImage);
}

export default class DicomChunkImage
  extends BaseProgressiveImage
  implements ChunkImage
{
  protected chunks: Chunk[];
  private chunkListeners: Array<() => void>;
  private thumbnailCache: WeakMap<Chunk, Promise<unknown>>;
  private events: Emitter<ChunkImageEvents>;
  private chunkStatus: ChunkStatus[];

  public segBuildInfo:
    | (JsonCompatible & ReadOverlappingSegmentationMeta)
    | null;

  constructor() {
    super();

    this.status.value = 'incomplete';
    this.loaded = computed(() => {
      return !this.loading.value && this.status.value === 'complete';
    });

    this.chunks = [];
    this.chunkListeners = [];
    this.chunkStatus = [];
    this.thumbnailCache = new WeakMap();
    this.events = mitt();
    this.segBuildInfo = null;

    this.addEventListener('loading', (loading) => {
      this.loading.value = loading;
    });

    this.addEventListener('status', (status) => {
      this.status.value = status;
    });
  }

  getModality() {
    const meta = Object.fromEntries(this.getDicomMetadata() ?? []);
    return meta[Tags.Modality]?.trim() ?? null;
  }

  getChunkStatuses(): Array<ChunkStatus> {
    return this.chunkStatus.slice();
  }

  getDicomMetadata(chunkNum = 0) {
    if (chunkNum < 0 || chunkNum >= this.chunks.length) {
      throw RangeError('chunkNum is out of bounds');
    }
    return this.chunks[chunkNum].metadata;
  }

  getChunks() {
    return this.chunks.slice();
  }

  addEventListener<T extends keyof ChunkImageEvents>(
    type: T,
    callback: (info: ChunkImageEvents[T]) => void
  ): void {
    this.events.on(type, callback);
  }

  removeEventListener<T extends keyof ChunkImageEvents>(
    type: T,
    callback: (info: ChunkImageEvents[T]) => void
  ): void {
    this.events.off(type, callback);
  }

  dispose() {
    super.dispose();
    this.unregisterChunkListeners();
    this.events.all.clear();
    this.chunks.length = 0;
    this.vtkImageData.value.delete();
    this.chunkStatus = [];
    this.thumbnailCache = new WeakMap();
  }

  startLoad() {
    this.chunks.forEach((chunk) => {
      chunk.loadData();
    });
    this.events.emit('loading', true);
  }

  stopLoad() {
    this.chunks.forEach((chunk) => {
      chunk.stopLoad();
    });
    this.events.emit('loading', false);
  }

  async addChunks(chunks: Chunk[]) {
    this.unregisterChunkListeners();

    const existingIds = new Set(this.chunks.map((chunk) => getChunkId(chunk)));
    const newChunks = chunks.filter(
      (chunk) => !existingIds.has(getChunkId(chunk))
    );
    newChunks.forEach((chunk) => {
      this.chunks.push(chunk);
    });

    await Promise.all(chunks.map((chunk) => chunk.loadMeta()));
    const chunksByVolume = await splitAndSort(
      this.chunks,
      (chunk) => chunk.metaBlob!
    );
    const volumes = Object.values(chunksByVolume);
    if (volumes.length !== 1)
      throw new Error('Did not get just a single volume!');

    // save the newly sorted chunk order
    this.chunks = volumes[0];

    this.chunkStatus = this.chunks.map((chunk) => {
      switch (chunk.state) {
        case ChunkState.Init:
        case ChunkState.MetaLoading:
        case ChunkState.MetaOnly:
          return ChunkStatus.NotLoaded;
        case ChunkState.DataLoading:
          return ChunkStatus.Loading;
        case ChunkState.Loaded:
          return ChunkStatus.Loaded;
        default:
          throw new Error('Chunk is in an invalid state');
      }
    });
    this.onChunksUpdated();

    if (this.getModality() !== 'SEG') {
      this.reallocateImage();
    }

    this.registerChunkListeners();
    this.processNewChunks(newChunks);
  }

  getThumbnail(strategy: ThumbnailStrategy): Promise<any> {
    if (strategy !== ThumbnailStrategy.MiddleSlice)
      throw new Error('Can only handle MiddleSlice thumbnailing strategy');

    const middle = Math.floor(this.chunks.length / 2);
    const chunk = this.chunks[middle];

    if (!this.thumbnailCache.has(chunk)) {
      // FIXME(fli): if chunk changes, the old promise is not cancelled
      this.thumbnailCache.set(
        chunk,
        waitForChunkState(chunk, ChunkState.Loaded).then((ch) => {
          if (!ch.dataBlob) throw new Error('No chunk data');
          return dicomSliceToImageUri(ch.dataBlob);
        })
      );
    }
    return this.thumbnailCache.get(chunk)!;
  }

  private processNewChunks(chunks: Chunk[]) {
    chunks
      .filter((chunk) => chunk.state === ChunkState.Loaded)
      .forEach((chunk) => {
        const idx = this.chunks.indexOf(chunk);
        if (idx !== -1) {
          this.onChunkHasData(idx);
        }
      });
  }

  private registerChunkListeners() {
    this.chunkListeners = [
      ...this.chunks.map((chunk, index) => {
        const stopDoneData = chunk.addEventListener('doneData', () => {
          this.onChunkHasData(index);
        });

        const stopError = chunk.addEventListener('error', (err) => {
          this.onChunkErrored(index, err);
        });

        return () => {
          stopDoneData();
          stopError();
        };
      }),
    ];
  }

  private unregisterChunkListeners() {
    while (this.chunkListeners.length) {
      this.chunkListeners.pop()!();
    }
  }

  private reallocateImage() {
    this.vtkImageData.value.delete();
    this.vtkImageData.value = allocateImageFromChunks(this.chunks);

    // recalculate image data's data range, since allocateImageFromChunks doesn't know anything about it
    const scalars = this.vtkImageData.value.getPointData().getScalars();
    this.dataRangeFromChunks().forEach(([min, max], compIdx) => {
      scalars.setRange({ min, max }, compIdx);
    });
    scalars.modified(); // so image-stats will trigger update of range
  }

  private dataRangeFromChunks() {
    const outputRanges: Array<[number, number]> = [];
    this.chunks.forEach((chunk) => {
      const ranges = chunk.getUserData(DATA_RANGE_KEY) as
        | Array<[number, number]>
        | undefined;
      if (!ranges) return;
      ranges.forEach((range, idx) => {
        const curMin = outputRanges[idx]?.[0] ?? range[0];
        const curMax = outputRanges[idx]?.[1] ?? range[1];
        outputRanges[idx] = [
          Math.min(curMin, range[0]),
          Math.max(curMax, range[1]),
        ];
      });
    });

    return outputRanges;
  }

  private async onChunkHasData(chunkIndex: number) {
    if (this.getModality() === 'SEG') {
      await this.onSegChunkHasData(chunkIndex);
    } else {
      await this.onRegularChunkHasData(chunkIndex);
    }
  }

  private async onSegChunkHasData(chunkIndex: number) {
    if (this.chunks.length !== 1 || chunkIndex !== 0)
      throw new Error('cannot handle multiple seg files');

    const [chunk] = this.chunks;
    const results = await buildSegmentGroups(
      new File([chunk.dataBlob!], 'seg.dcm')
    );
    const image = vtkITKHelper.convertItkToVtkImage(results.outputImage);
    this.vtkImageData.value.delete();
    this.vtkImageData.value = image;

    this.segBuildInfo = results.metaInfo;

    this.chunkStatus[0] = ChunkStatus.Loaded;
    this.onChunksUpdated();
  }

  private async onRegularChunkHasData(chunkIndex: number) {
    const chunk = this.chunks[chunkIndex];
    if (!chunk.dataBlob) throw new Error('Chunk does not have data');
    const result = await readImage(
      new File([chunk.dataBlob], `file-${chunkIndex}.dcm`),
      {
        webWorker: getWorker(),
      }
    );

    if (!result.image.data) throw new Error('No data read from chunk');

    const scalars = this.vtkImageData.value.getPointData().getScalars();
    const pixelData = scalars.getData() as TypedArray;

    const dims = this.vtkImageData.value.getDimensions();
    const offset =
      dims[0] * dims[1] * scalars.getNumberOfComponents() * chunkIndex;
    pixelData.set(result.image.data as TypedArray, offset);

    const rangeAlreadyInitialized = this.chunkStatus.some(
      (status) => status === ChunkStatus.Loaded
    );

    // update the data range
    const chunkDataRange: Array<[number, number]> = [];
    for (let comp = 0; comp < scalars.getNumberOfComponents(); comp++) {
      const { min, max } = fastComputeRange(
        result.image.data as unknown as number[],
        comp,
        scalars.getNumberOfComponents()
      );
      chunkDataRange.push([min, max]);

      const curRange = scalars.getRange(comp);

      const newMin = rangeAlreadyInitialized ? Math.min(min, curRange[0]) : min;
      const newMax = rangeAlreadyInitialized ? Math.max(max, curRange[1]) : max;
      scalars.setRange({ min: newMin, max: newMax }, comp);
    }
    scalars.modified(); // so image-stats will trigger update of range

    chunk.setUserData(DATA_RANGE_KEY, chunkDataRange);

    this.chunkStatus[chunkIndex] = ChunkStatus.Loaded;
    this.events.emit('chunkLoad', {
      chunk,
      updatedExtent: [0, dims[0] - 1, 0, dims[1] - 1, chunkIndex, chunkIndex],
    });
    this.onChunksUpdated();

    this.vtkImageData.value.modified();
  }

  private onChunkErrored(chunkIndex: number, err: unknown) {
    this.chunkStatus[chunkIndex] = ChunkStatus.Errored;
    this.events.emit('chunkError', {
      chunk: this.chunks[chunkIndex],
      error: err,
    });
    this.events.emit('error', ensureError(err));
    this.onChunksUpdated();
  }

  private computeStatus(): ProgressiveImageStatus {
    for (let i = 0; i < this.chunkStatus.length; i++) {
      if (this.chunkStatus[i] !== ChunkStatus.Loaded) return 'incomplete';
    }
    return 'complete';
  }

  private onChunksUpdated() {
    const status = this.computeStatus();
    this.events.emit('status', status);
    if (status === 'complete') {
      this.events.emit('loading', false);
    }
  }
}
