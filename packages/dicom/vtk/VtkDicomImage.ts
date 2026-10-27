import {
  Chunk,
  ChunkState,
  getChunkTag,
  readInstanceFacts,
  reconstructInstances,
  sliceNormalOf,
  type Reconstruction,
} from '../core/index';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { TypedArray } from '@kitware/vtk.js/types';
import mitt, { Emitter } from 'mitt';
import {
  allocateImageFromChunks,
  type IrregularGeometryPolicy,
} from './allocateImageFromChunks';
import {
  assertSamplesRepresentable,
  assertSingleFramePerFile,
  assertChunkFitsSlot,
} from './pixelValidation';
import { applyUltrasoundSpacing } from './ultrasoundSpacing';
import {
  ChunkStatus,
  type ChunkImageEvents,
  type ProgressiveImageStatus,
  type VtkDicomImageInit,
} from './types';
import { encodeThumbnailToUri } from './thumbnail';
import { sliceFromBuffer, sliceFromChunk } from './thumbnailSource';
import { untilAborted } from './lifetime';

const ensureError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

const { fastComputeRange } = vtkDataArray;

const DATA_RANGE_KEY = 'pixel-data-range';

const getChunkId = (chunk: Chunk) => getChunkTag(chunk, '00080018');

// A scan, not a map of the header: this runs once per decoded chunk.
const modalityOf = (chunks: Chunk[]) =>
  chunks.length > 0
    ? (getChunkTag(chunks[0], '00080060')?.trim() ?? null)
    : null;

const sameChunkOrder = (first: Chunk[], second: Chunk[]) =>
  first.length === second.length &&
  first.every((chunk, index) => chunk === second[index]);

function initialChunkStatus(chunk: Chunk) {
  switch (chunk.state) {
    case ChunkState.Init:
    case ChunkState.MetaLoading:
    case ChunkState.MetaOnly:
      return ChunkStatus.NotLoaded;
    case ChunkState.DataLoading:
      return ChunkStatus.Loading;
    // Loaded pixels belong to the previous allocation.
    case ChunkState.Loaded:
      return ChunkStatus.Loading;
    default:
      throw new Error('Chunk is in an invalid state');
  }
}

export class VtkDicomImage {
  private encodeThumbnail: NonNullable<VtkDicomImageInit['encodeThumbnail']>;
  private readDicomImage: VtkDicomImageInit['readDicomImage'];
  private warn: NonNullable<VtkDicomImageInit['warn']>;
  protected chunks: Chunk[];
  private orientation: number[] | null = null;
  private reconstruction: Reconstruction | null = null;
  private image = vtkImageData.newInstance();
  private loading = false;
  private status: ProgressiveImageStatus = 'incomplete';
  private readonly irregularGeometry: IrregularGeometryPolicy;
  private readonly readSegmentation: VtkDicomImageInit['readSegmentation'];
  public segmentationMetadata: unknown = null;
  private chunkListeners: Array<() => void>;
  private events: Emitter<ChunkImageEvents>;
  private chunkStatus: ChunkStatus[];
  private allocationGeneration: number;
  private chunkUpdateQueue: Promise<void>;
  private disposed: boolean;
  private readonly lifetime = new AbortController();
  private thumbnailLifetime = new AbortController();
  private thumbnail: Promise<string | null> | null;

  constructor(init: VtkDicomImageInit) {
    this.encodeThumbnail = init.encodeThumbnail ?? encodeThumbnailToUri;
    this.readDicomImage = init.readDicomImage;
    this.warn = init.warn ?? (() => {});
    this.irregularGeometry = init.irregularGeometry ?? 'preserve-order';
    this.readSegmentation = init.readSegmentation;

    this.chunks = [];
    this.chunkListeners = [];
    this.chunkStatus = [];
    this.events = mitt();
    this.allocationGeneration = 0;
    this.chunkUpdateQueue = Promise.resolve();
    this.disposed = false;
    this.thumbnail = null;

    this.addEventListener('loading', (loading) => {
      this.loading = loading;
    });

    this.addEventListener('status', (status) => {
      this.status = status;
    });
  }

  getVtkImageData() {
    return this.image;
  }

  getStatus() {
    return this.status;
  }

  isLoading() {
    return this.loading;
  }

  isLoaded() {
    return !this.loading && this.status === 'complete';
  }

  getReconstruction() {
    return this.reconstruction ? structuredClone(this.reconstruction) : null;
  }

  private replaceImage(image: vtkImageData) {
    const previous = this.image;
    this.image = image;
    this.events.emit('imageChanged', image);
    previous.delete();
  }

  getModality() {
    return modalityOf(this.chunks);
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

  getOrientation() {
    return this.orientation?.slice() ?? null;
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
    if (this.disposed) return;
    this.disposed = true;
    this.lifetime.abort();
    this.thumbnailLifetime.abort();
    this.allocationGeneration += 1;
    this.unregisterChunkListeners();
    this.events.all.clear();
    this.chunks.length = 0;
    this.image.delete();
    this.chunkStatus = [];
  }

  startLoad() {
    if (this.disposed) return;
    this.chunks.forEach((chunk, index) => {
      if (chunk.state === ChunkState.Loaded) {
        if (
          this.chunkStatus[index] === ChunkStatus.Loaded ||
          this.chunkStatus[index] === ChunkStatus.Loading
        )
          return;
        this.chunkStatus[index] = ChunkStatus.Loading;
        this.decodeChunk(chunk);
      } else {
        this.chunkStatus[index] = ChunkStatus.Loading;
        chunk.loadData().catch(() => {});
      }
    });
    this.events.emit('loading', !this.isSettled());
  }

  stopLoad() {
    this.invalidateThumbnail();
    this.allocationGeneration += 1;
    this.chunks.forEach((chunk) => {
      chunk.stopLoad();
    });
    this.chunkStatus = this.chunkStatus.map((status) =>
      status === ChunkStatus.Loading ? ChunkStatus.NotLoaded : status
    );
    this.events.emit('loading', false);
  }

  /**
   * Replaces this image's membership and order. Grouping and ordering belong
   * to the collection planner, so the chunks are taken exactly as given.
   */
  setChunks(
    chunks: Chunk[],
    orientation: number[] | null,
    reconstruction?: Reconstruction
  ) {
    const ordered = chunks.slice();
    const axes = orientation?.slice() ?? null;
    const geometry = reconstruction
      ? structuredClone(reconstruction)
      : undefined;
    const update = this.chunkUpdateQueue.then(() =>
      this.applyChunks(ordered, axes, geometry)
    );
    this.chunkUpdateQueue = update.catch(() => {});
    return update;
  }

  private sameMembership(
    chunks: Chunk[],
    orientation: number[] | null,
    supplied?: Reconstruction
  ) {
    return (
      orientation?.join() === this.orientation?.join() &&
      sameChunkOrder(chunks, this.chunks) &&
      (!supplied || sameReconstruction(supplied, this.reconstruction))
    );
  }

  private async loadMetadata(chunks: Chunk[]) {
    try {
      await untilAborted(
        Promise.all(chunks.map((chunk) => chunk.loadMeta())),
        this.lifetime.signal
      );
    } catch (error) {
      if (!this.disposed) throw error;
    }
  }

  private async applyChunks(
    chunks: Chunk[],
    orientation: number[] | null,
    supplied?: Reconstruction
  ) {
    if (this.sameMembership(chunks, orientation, supplied)) return;

    if (this.disposed) return;
    await this.loadMetadata(chunks);
    if (this.disposed) return;

    const status = chunks.map(initialChunkStatus);
    const reconstruction = reconstructInstances(
      chunks.map((chunk) => readInstanceFacts(chunk.metadata!)),
      sliceNormalOf(orientation),
      supplied
    );
    const allocated =
      modalityOf(chunks) === 'SEG'
        ? null
        : allocateImageFromChunks(
            chunks,
            orientation,
            reconstruction,
            this.irregularGeometry
          );

    this.unregisterChunkListeners();

    this.allocationGeneration += 1;
    this.chunks = chunks;
    this.orientation = orientation;
    this.reconstruction = reconstruction;
    this.chunkStatus = status;
    this.invalidateThumbnail();
    this.segmentationMetadata = null;
    this.onChunksUpdated();

    if (allocated) {
      applyUltrasoundSpacing(allocated, chunks, this.warn);
      this.replaceImage(allocated);
    }

    this.registerChunkListeners();
    this.processLoadedChunks();

    if (allocated) {
      this.updateDataRangeFromChunks();
    }
  }

  private invalidateThumbnail() {
    this.thumbnailLifetime.abort();
    this.thumbnailLifetime = new AbortController();
    this.thumbnail = null;
  }

  getThumbnail(): Promise<string | null> {
    if (this.disposed) return Promise.reject(this.lifetime.signal.reason);
    if (!this.thumbnail) {
      const requested = this.readThumbnail().catch((error) => {
        if (this.thumbnail === requested) this.thumbnail = null;
        throw error;
      });
      this.thumbnail = requested;
    }
    return this.thumbnail;
  }

  private async readThumbnail(): Promise<string | null> {
    const signal = this.thumbnailLifetime.signal;
    const middle = Math.floor(this.chunks.length / 2);
    const chunk = this.chunks[middle];
    if (!chunk) return null;

    const slice =
      this.chunkStatus[middle] === ChunkStatus.Loaded
        ? sliceFromBuffer(this.image, this.reconstruction!.slots[middle])
        : await sliceFromChunk(chunk, this.readDicomImage, signal);

    signal.throwIfAborted();
    return this.encodeThumbnail(slice);
  }

  // Reallocation clears the buffer, so restore every available slice.
  private processLoadedChunks() {
    this.chunks.forEach((chunk) => {
      if (chunk.state !== ChunkState.Loaded) return;
      this.decodeChunk(chunk);
    });
  }

  private decodeChunk(chunk: Chunk) {
    const generation = this.allocationGeneration;
    this.onChunkHasData(chunk, generation).catch((err) => {
      if (generation !== this.allocationGeneration) return;
      this.onChunkErrored(chunk, err);
    });
  }

  private registerChunkListeners() {
    this.chunkListeners = [
      ...this.chunks.map((chunk) => {
        const stopDoneData = chunk.addEventListener('doneData', () => {
          this.decodeChunk(chunk);
        });

        const stopError = chunk.addEventListener('error', (err) => {
          this.onChunkErrored(chunk, err);
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

  private updateDataRangeFromChunks() {
    const scalars = this.image.getPointData().getScalars();
    const ranges = this.dataRangeFromChunks();
    if (ranges.length > 0) {
      ranges.forEach(([min, max], compIdx) => {
        scalars.setRange({ min, max }, compIdx);
      });
      scalars.modified(); // so image-stats will trigger update of range
    }
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

  private async onChunkHasData(chunk: Chunk, generation: number) {
    if (this.getModality() === 'SEG') {
      await this.onSegChunkHasData(chunk, generation);
    } else {
      await this.onRegularChunkHasData(chunk, generation);
    }
  }

  private async onSegChunkHasData(chunk: Chunk, generation: number) {
    if (this.chunks.length !== 1 || this.chunks[0] !== chunk)
      throw new Error(
        `Cannot handle multiple SEG files. Expected 1 chunk at index 0, got ${this.chunks.length} chunks with current index ${this.chunks.indexOf(chunk)}`
      );

    if (!this.readSegmentation)
      throw new Error('A segmentation decoder is required for SEG objects');
    const results = await this.readSegmentation(
      new File([chunk.dataBlob!], 'seg.dcm')
    );
    if (generation !== this.allocationGeneration) {
      results.image.delete();
      return;
    }
    this.segmentationMetadata = results.metadata;
    this.replaceImage(results.image);

    this.chunkStatus[0] = ChunkStatus.Loaded;
    this.onChunksUpdated();
  }

  private async onRegularChunkHasData(chunk: Chunk, generation: number) {
    const chunkIndex = this.chunks.indexOf(chunk);
    if (!chunk.dataBlob)
      throw new Error(`Chunk ${chunkIndex} does not have data`);

    const chunkId = chunk.metadata ? getChunkId(chunk) : `index-${chunkIndex}`;
    const result = await this.readDicomImage(
      new File([chunk.dataBlob], `file-${chunkIndex}.dcm`),
      chunk.metadata ?? undefined
    );

    if (!result.image.data)
      throw new Error(`No data read from chunk ${chunkId}`);

    // Only the decode started for the current allocation may update it.
    if (generation !== this.allocationGeneration) return;

    const sliceIndex = this.chunks.indexOf(chunk);
    if (sliceIndex === -1) return;

    const where = `File ${chunkId} (chunk ${sliceIndex})`;
    assertSingleFramePerFile(result.image.size[2], this.chunks.length, where);

    const scalars = this.image.getPointData().getScalars();
    const pixelData = scalars.getData();
    const componentCount = scalars.getNumberOfComponents();

    const dims = this.image.getDimensions();

    assertChunkFitsSlot(
      result.image,
      { dims, componentCount, count: this.chunks.length },
      where
    );

    const chunkData = result.image.data as TypedArray;
    const chunkDataRange: Array<[number, number]> = [];
    for (let comp = 0; comp < componentCount; comp++) {
      const { min, max } = fastComputeRange(chunkData, comp, componentCount);
      chunkDataRange.push([min, max]);
    }

    const chunkMin = Math.min(...chunkDataRange.map(([min]) => min));
    const chunkMax = Math.max(...chunkDataRange.map(([, max]) => max));
    assertSamplesRepresentable(
      chunkData,
      { min: chunkMin, max: chunkMax },
      pixelData,
      where
    );

    const slot = this.reconstruction!.slots[sliceIndex];
    const offset = dims[0] * dims[1] * componentCount * slot;
    pixelData.set(chunkData, offset);

    const rangeAlreadyInitialized = this.chunkStatus.some(
      (status) => status === ChunkStatus.Loaded
    );

    chunkDataRange.forEach(([min, max], comp) => {
      const curRange = scalars.getRange(comp);
      const newMin = rangeAlreadyInitialized ? Math.min(min, curRange[0]) : min;
      const newMax = rangeAlreadyInitialized ? Math.max(max, curRange[1]) : max;
      scalars.setRange({ min: newMin, max: newMax }, comp);
    });
    scalars.modified(); // so image-stats will trigger update of range

    chunk.setUserData(DATA_RANGE_KEY, chunkDataRange);

    this.chunkStatus[sliceIndex] = ChunkStatus.Loaded;
    this.events.emit('chunkLoad', {
      chunk,
      updatedExtent: [
        0,
        dims[0] - 1,
        0,
        dims[1] - 1,
        slot,
        this.chunks.length === 1 ? dims[2] - 1 : slot,
      ],
    });
    this.onChunksUpdated();

    this.image.modified();
  }

  private onChunkErrored(chunk: Chunk, err: unknown) {
    const sliceIndex = this.chunks.indexOf(chunk);
    if (sliceIndex === -1) return;

    if (err instanceof Error && err.name === 'AbortError') {
      this.chunkStatus[sliceIndex] = ChunkStatus.NotLoaded;
      this.onChunksUpdated();
      this.events.emit(
        'loading',
        this.chunkStatus.includes(ChunkStatus.Loading)
      );
      return;
    }
    this.chunkStatus[sliceIndex] = ChunkStatus.Errored;
    this.events.emit('chunkError', {
      chunk,
      error: err,
    });
    this.events.emit('error', ensureError(err));
    this.onChunksUpdated();
  }

  // Failures settle this attempt; startLoad can retry their slots.
  private isSettled() {
    return this.chunkStatus.every(
      (status) =>
        status === ChunkStatus.Loaded || status === ChunkStatus.Errored
    );
  }

  private computeStatus(): ProgressiveImageStatus {
    const anyLoaded = this.chunkStatus.some(
      (status) => status === ChunkStatus.Loaded
    );
    // An image where every chunk errored holds no pixel data, so it is settled
    // but never complete.
    return this.isSettled() && anyLoaded ? 'complete' : 'incomplete';
  }

  private onChunksUpdated() {
    this.events.emit('status', this.computeStatus());
    if (this.isSettled()) {
      this.events.emit('loading', false);
    }
  }
}

function sameReconstruction(
  left: Reconstruction,
  right: Reconstruction | null
) {
  return JSON.stringify(left) === JSON.stringify(right);
}
