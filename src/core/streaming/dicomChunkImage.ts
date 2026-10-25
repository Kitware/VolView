import {
  readDicomSegmentation,
  ReadOverlappingSegmentationMeta,
} from '@/src/io/dicom';
import { Chunk } from '@/src/core/streaming/chunk';
import { getChunkTag } from '@/src/utils/dicom/dicomChunks';
import {
  Image,
  JsonCompatible,
  readImage as readItkImage,
} from '@itk-wasm/image-io';
import { getWorker } from '@/src/io/itk/worker';
import {
  allocateImageFromChunks,
  getBufferValueRange,
  samplesAreIntegral,
  valuesFitBuffer,
} from '@/src/utils/dicom/allocateImageFromChunks';
import { TypedArray } from '@kitware/vtk.js/types';
import { Tags } from '@/src/core/dicomTags';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { ChunkState } from '@/src/core/streaming/chunkStateMachine';
import {
  type ChunkImage,
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
import { convertItkToVtkImage } from '@/src/io/convertItkToVtkImage';
import { unitToMm } from '@/src/core/streaming/dicom/ultrasoundRegion';
import { isUsableSpacing } from '@/src/utils/imageSpace';
import { surfaceWarning } from '@/src/store/messages';
import {
  encodeThumbnailToUri,
  sliceToThumbnail,
  type ThumbnailSlice,
} from '@/src/core/streaming/dicomThumbnail';

const { fastComputeRange } = vtkDataArray;

const DATA_RANGE_KEY = 'pixel-data-range';

const getChunkId = (chunk: Chunk) => getChunkTag(chunk, Tags.SOPInstanceUID);

function readDicomImage(file: File) {
  return readItkImage(file, { webWorker: getWorker() });
}

// A scan, not a map of the header: this runs once per decoded chunk.
const modalityOf = (chunks: Chunk[]) =>
  chunks.length > 0
    ? (getChunkTag(chunks[0], Tags.Modality)?.trim() ?? null)
    : null;

/**
 * The chunk once its bytes are in, or the error that means they never will
 * be. A chunk that errored settles back to holding metadata only, so waiting
 * on the loaded state alone would wait forever.
 */
const loadedChunk = (chunk: Chunk) =>
  new Promise<Chunk>((resolve, reject) => {
    if (chunk.state === ChunkState.Loaded) {
      resolve(chunk);
      return;
    }
    const stopWatching = chunk.watchForState(ChunkState.Loaded, () => {
      stopListening();
      resolve(chunk);
    });
    const stopListening = () => {
      stopWatching();
      stopOnError();
    };
    const stopOnError = chunk.addEventListener('error', (err) => {
      stopListening();
      reject(ensureError(err));
    });
  });

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

export interface DicomChunkImageInit {
  encodeThumbnail: (slice: ThumbnailSlice) => string;
  readDicomImage: (file: File) => Promise<{
    image: Pick<Image, 'size' | 'data'> & {
      imageType: Pick<Image['imageType'], 'components'>;
    };
  }>;
  warn: (title: string, details: string) => void;
}

type DecodedChunkImage = Awaited<
  ReturnType<DicomChunkImageInit['readDicomImage']>
>['image'];

// The buffer is allocated for the range every chunk's tags declare, so a chunk
// only fails here when its decoded values disagree with its tags.
// TypedArray.set raises nothing for such values: integers wrap and fractions
// truncate.
function assertSamplesRepresentable(
  decoded: ArrayLike<number>,
  range: { min: number; max: number },
  buffer: TypedArray,
  where: string
) {
  if (!valuesFitBuffer(range, buffer)) {
    const bufferRange = getBufferValueRange(buffer)!;
    throw new Error(
      `${where} has pixel values the volume it belongs to cannot represent. ` +
        `Its pixel values run from ${range.min} to ${range.max}, but the volume's buffer is ` +
        `${buffer.constructor.name}, holding values from ${bufferRange.min} to ${bufferRange.max}. ` +
        `Every file in a volume must decode to values its buffer can hold without conversion.`
    );
  }
  if (!samplesAreIntegral(decoded, buffer)) {
    throw new Error(
      `${where} has fractional pixel values the volume it belongs to cannot represent. ` +
        `Its pixel values run from ${range.min} to ${range.max}, but the volume's buffer is ` +
        `${buffer.constructor.name}, which holds only whole numbers. ` +
        `Every file in a volume must decode to values its buffer can hold without conversion.`
    );
  }
}

export default class DicomChunkImage
  extends BaseProgressiveImage
  implements ChunkImage
{
  private encodeThumbnail: DicomChunkImageInit['encodeThumbnail'];
  private readDicomImage: DicomChunkImageInit['readDicomImage'];
  private warn: DicomChunkImageInit['warn'];
  protected chunks: Chunk[];
  private orientation: number[] | null = null;
  private chunkListeners: Array<() => void>;
  private events: Emitter<ChunkImageEvents>;
  private chunkStatus: ChunkStatus[];
  private allocationGeneration: number;
  private chunkUpdateQueue: Promise<void>;
  private disposed: boolean;
  // One thumbnail per membership: the browser asks again whenever the volume
  // list changes, and each ask before the slot is decoded costs a decode.
  private thumbnail: Promise<string | null> | null;

  public segBuildInfo:
    | (JsonCompatible & ReadOverlappingSegmentationMeta)
    | null;

  constructor(init: Partial<DicomChunkImageInit> = {}) {
    super();

    this.encodeThumbnail = init.encodeThumbnail ?? encodeThumbnailToUri;
    this.readDicomImage = init.readDicomImage ?? readDicomImage;
    this.warn = init.warn ?? surfaceWarning;

    this.status.value = 'incomplete';
    this.loaded = computed(() => {
      return !this.loading.value && this.status.value === 'complete';
    });

    this.chunks = [];
    this.chunkListeners = [];
    this.chunkStatus = [];
    this.events = mitt();
    this.allocationGeneration = 0;
    this.chunkUpdateQueue = Promise.resolve();
    this.disposed = false;
    this.thumbnail = null;
    this.segBuildInfo = null;

    this.addEventListener('loading', (loading) => {
      this.loading.value = loading;
    });

    this.addEventListener('status', (status) => {
      this.status.value = status;
    });
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
    this.disposed = true;
    this.allocationGeneration += 1;
    super.dispose();
    this.unregisterChunkListeners();
    this.events.all.clear();
    this.chunks.length = 0;
    this.vtkImageData.value.delete();
    this.chunkStatus = [];
  }

  startLoad() {
    this.chunks.forEach((chunk) => {
      chunk.loadData();
    });
    // An image whose every slot is already settled has nothing to load, and
    // nothing later would report it done.
    this.events.emit('loading', !this.isSettled());
  }

  stopLoad() {
    this.chunks.forEach((chunk) => {
      chunk.stopLoad();
    });
    this.events.emit('loading', false);
  }

  /**
   * Replaces this image's membership and order. Grouping and ordering belong
   * to the collection planner, so the chunks are taken exactly as given.
   */
  setChunks(chunks: Chunk[], orientation: number[] | null) {
    const ordered = chunks.slice();
    const axes = orientation?.slice() ?? null;
    const update = this.chunkUpdateQueue.then(() =>
      this.applyChunks(ordered, axes)
    );
    this.chunkUpdateQueue = update.catch(() => {});
    return update;
  }

  private async applyChunks(chunks: Chunk[], orientation: number[] | null) {
    // A replan that only relabels the collection re-supplies the same
    // members; reallocating would blank every loaded slice for nothing.
    if (
      orientation?.join() === this.orientation?.join() &&
      sameChunkOrder(chunks, this.chunks)
    )
      return;

    // Nothing changes while the metadata the allocation needs is still coming,
    // and a disposed image must not come back to life afterwards.
    if (this.disposed) return;
    await Promise.all(chunks.map((chunk) => chunk.loadMeta()));
    if (this.disposed) return;

    // Everything that can throw runs before the first mutation, so a
    // membership this image cannot hold leaves it exactly as it was.
    const status = chunks.map(initialChunkStatus);
    const allocated =
      modalityOf(chunks) === 'SEG'
        ? null
        : allocateImageFromChunks(chunks, orientation);

    this.unregisterChunkListeners();

    // Invalidate decodes targeting the previous buffer and chunk order.
    this.allocationGeneration += 1;
    this.chunks = chunks;
    this.orientation = orientation;
    this.chunkStatus = status;
    this.thumbnail = null;
    this.onChunksUpdated();

    if (allocated) {
      const previous = this.vtkImageData.value;
      this.vtkImageData.value = allocated;
      previous.delete();
      this.applyUltrasoundSpacing();
    }

    this.registerChunkListeners();
    this.processLoadedChunks();

    // Update data range with already loaded chunks after reallocating image
    if (allocated) {
      this.updateDataRangeFromChunks();
    }
  }

  getThumbnail(): Promise<string | null> {
    // A failure is not kept: the next ask tries again.
    this.thumbnail ??= this.readThumbnail().catch((err) => {
      this.thumbnail = null;
      throw err;
    });
    return this.thumbnail;
  }

  private async readThumbnail(): Promise<string | null> {
    const middle = Math.floor(this.chunks.length / 2);
    const chunk = this.chunks[middle];
    if (!chunk) return null;

    const slice =
      this.chunkStatus[middle] === ChunkStatus.Loaded
        ? this.sliceFromBuffer(middle)
        : await this.sliceFromChunk(chunk);

    return this.encodeThumbnail(slice);
  }

  private sliceFromBuffer(index: number) {
    const scalars = this.vtkImageData.value.getPointData().getScalars();
    const components = scalars.getNumberOfComponents();
    const [width, height] = this.vtkImageData.value.getDimensions();
    const samplesPerSlice = width * height * components;
    const data = scalars.getData() as TypedArray;

    return sliceToThumbnail({
      data: data.subarray(
        index * samplesPerSlice,
        (index + 1) * samplesPerSlice
      ),
      width,
      height,
      components,
      // The thumbnail reads component 0, so it windows on that component's
      // range, not the multi-component vector magnitude range.
      range: scalars.getRange(0) as [number, number],
    });
  }

  // Before a chunk's slot holds pixels, its own bytes are the only source.
  private async sliceFromChunk(chunk: Chunk) {
    const loaded = await loadedChunk(chunk);
    if (!loaded.dataBlob) throw new Error('No chunk data');

    const { image } = await this.readDicomImage(
      new File([loaded.dataBlob], 'thumbnail.dcm')
    );
    if (!image.data) throw new Error('No data read from chunk');

    const [width, height] = image.size;
    const components = image.imageType.components;
    const data = image.data as unknown as ArrayLike<number>;
    const { min, max } = fastComputeRange(
      data as unknown as number[],
      0,
      components
    );

    return sliceToThumbnail({
      data,
      width,
      height,
      components,
      range: [min, max],
    });
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

  private applyUltrasoundSpacing() {
    if (this.getModality() !== 'US') return;

    // Ultrasound DICOMs are typically a single multi-frame chunk, so the
    // region table on chunk[0] applies to the whole image. If a US series
    // ever spanned multiple chunks with differing regions, this would
    // silently use the first chunk's spacing for all of them.
    const regions = this.chunks[0]?.ultrasoundRegions;
    if (!regions?.region) return;

    // VTK image data has a single global spacing, so multi-region images
    // (e.g. dual-pane B-mode + Doppler) cannot be fully represented. The
    // first region's spacing is applied to the whole image; warn so the
    // mismatch on additional panes is at least visible in the console.
    if (regions.regionCount > 1) {
      console.warn(
        `Ultrasound image has ${regions.regionCount} regions; only the first region's physical spacing is applied. Multi-region (e.g. dual-pane B-mode + Doppler) ultrasound is not fully supported.`
      );
    }

    const { region } = regions;
    const xFactor = unitToMm(region.physicalUnitsXDirection);
    const yFactor = unitToMm(region.physicalUnitsYDirection);
    // All-or-nothing: if either axis lacks a spatial unit (e.g. one axis is
    // cm and the other is seconds, or unitless) the metadata can't be trusted
    // as a 2D physical spacing, so leave the default 1mm fallback in place.
    if (xFactor === null || yFactor === null) {
      console.warn(
        `Ultrasound spacing not applied: PhysicalUnitsXDirection=${region.physicalUnitsXDirection}, PhysicalUnitsYDirection=${region.physicalUnitsYDirection}; only code 3 (cm) is converted to mm.`
      );
      return;
    }

    const spacingX = region.physicalDeltaX * xFactor;
    const spacingY = region.physicalDeltaY * yFactor;
    if (!isUsableSpacing(spacingX) || !isUsableSpacing(spacingY)) {
      this.warn(
        'Invalid ultrasound calibration',
        `The ultrasound region declares PhysicalDeltaX=${region.physicalDeltaX} and PhysicalDeltaY=${region.physicalDeltaY}. Measurements use the image pixel spacing instead.`
      );
      return;
    }

    const [, , zSpacing] = this.vtkImageData.value.getSpacing();
    this.vtkImageData.value.setSpacing([spacingX, spacingY, zSpacing]);
  }

  private updateDataRangeFromChunks() {
    const scalars = this.vtkImageData.value.getPointData().getScalars();
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

    const results = await readDicomSegmentation(
      new File([chunk.dataBlob!], 'seg.dcm')
    );
    if (generation !== this.allocationGeneration) return;

    const image = convertItkToVtkImage(results.outputImage);
    this.vtkImageData.value.delete();
    this.vtkImageData.value = image;

    this.segBuildInfo = results.metaInfo;

    this.chunkStatus[0] = ChunkStatus.Loaded;
    this.onChunksUpdated();
  }

  // The slot layout gives one frame per file, so several files that each carry
  // several frames have nowhere to go.
  private assertSingleFramePerFile(frames: number, where: string) {
    if (frames > 1 && this.chunks.length > 1) {
      // we're trying to load multiple chunks where individual chunks have multiple frames
      throw new Error(
        `Loading a single volume from multiple DICOM files where individual files contain multiple frames is not supported. ` +
          `${where} contains ${frames} frames.`
      );
    }
  }

  // Each chunk gets a fixed slot: one frame per chunk in a multi-file volume,
  // or the whole volume when a single multi-frame chunk fills it. A decoded
  // chunk has to fill its slot exactly.
  private assertChunkFitsSlot(
    image: DecodedChunkImage,
    volume: { dims: number[]; componentCount: number },
    where: string
  ) {
    const { dims, componentCount } = volume;
    const multiFile = this.chunks.length > 1;
    const framesPerChunk = multiFile ? 1 : dims[2];
    const [chunkWidth, chunkHeight] = image.size;
    const chunkFrames = image.size[2] ?? 1;
    const chunkComponents = image.imageType.components;
    if (
      chunkWidth !== dims[0] ||
      chunkHeight !== dims[1] ||
      chunkFrames !== framesPerChunk ||
      chunkComponents !== componentCount
    ) {
      // A lone chunk defines the volume it fails to fit, so advice about
      // agreeing with the other files only makes sense for a multi-file volume.
      const advice = multiFile
        ? ' Every file in a volume must have the same Rows, Columns, and SamplesPerPixel.'
        : '';
      throw new Error(
        `${where} does not fit the volume it belongs to. ` +
          `It decoded to ${chunkWidth}x${chunkHeight}x${chunkFrames} with ${chunkComponents} component(s), ` +
          `but the volume has room for ${dims[0]}x${dims[1]}x${framesPerChunk} with ${componentCount} component(s).` +
          advice
      );
    }
  }

  private async onRegularChunkHasData(chunk: Chunk, generation: number) {
    const chunkIndex = this.chunks.indexOf(chunk);
    if (!chunk.dataBlob)
      throw new Error(`Chunk ${chunkIndex} does not have data`);

    const chunkId = chunk.metadata ? getChunkId(chunk) : `index-${chunkIndex}`;
    const result = await this.readDicomImage(
      new File([chunk.dataBlob], `file-${chunkIndex}.dcm`)
    );

    if (!result.image.data)
      throw new Error(`No data read from chunk ${chunkId}`);

    // Only the decode started for the current allocation may update it.
    if (generation !== this.allocationGeneration) return;

    // Sorting may have changed across the await; resolve the slot now.
    const sliceIndex = this.chunks.indexOf(chunk);
    if (sliceIndex === -1) return;

    const where = `File ${chunkId} (chunk ${sliceIndex})`;
    this.assertSingleFramePerFile(result.image.size[2], where);

    const scalars = this.vtkImageData.value.getPointData().getScalars();
    const pixelData = scalars.getData();
    const componentCount = scalars.getNumberOfComponents();

    const dims = this.vtkImageData.value.getDimensions();

    this.assertChunkFitsSlot(result.image, { dims, componentCount }, where);

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

    const offset = dims[0] * dims[1] * componentCount * sliceIndex;
    pixelData.set(chunkData, offset);

    const rangeAlreadyInitialized = this.chunkStatus.some(
      (status) => status === ChunkStatus.Loaded
    );

    // update the data range
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
      updatedExtent: [0, dims[0] - 1, 0, dims[1] - 1, sliceIndex, sliceIndex],
    });
    this.onChunksUpdated();

    this.vtkImageData.value.modified();
  }

  private onChunkErrored(chunk: Chunk, err: unknown) {
    // Sorting may have changed since the operation started.
    const sliceIndex = this.chunks.indexOf(chunk);
    if (sliceIndex === -1) return;

    this.chunkStatus[sliceIndex] = ChunkStatus.Errored;
    this.events.emit('chunkError', {
      chunk,
      error: err,
    });
    this.events.emit('error', ensureError(err));
    this.onChunksUpdated();
  }

  // Errored is terminal: a rejected chunk never loads, so waiting on it would
  // keep the image loading forever.
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
