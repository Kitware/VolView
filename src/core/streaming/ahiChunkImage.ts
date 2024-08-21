import { Chunk, waitForChunkState } from '@/src/core/streaming/chunk';
import { Image } from '@itk-wasm/image-io';
import { allocateImageFromChunks } from '@/src/utils/allocateImageFromChunks';
import { Maybe } from '@/src/types';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { TypedArray } from '@kitware/vtk.js/types';
import { useImageStore } from '@/src/store/datasets-images';
import {
  PatientInfo,
  StudyInfo,
  VolumeInfo,
  useDICOMStore,
} from '@/src/store/datasets-dicom';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { ChunkState } from '@/src/core/streaming/chunkStateMachine';
import {
  type ChunkImage,
  ThumbnailStrategy,
  ChunkStatus,
  ChunkImageEvents,
} from '@/src/core/streaming/chunkImage';
import { ComputedRef, Ref, computed, ref } from 'vue';
import mitt, { Emitter } from 'mitt';
import { decode } from '@itk-wasm/htj2k';
import { getWorker } from '@/src/io/itk/worker';
import { NameToMeta } from '../dicomTags';

const { fastComputeRange } = vtkDataArray;

export const nameToMetaKey = {
  SOPInstanceUID: 'SOPInstanceUID',
  ImagePositionPatient: 'ImagePositionPatient',
  ImageOrientationPatient: 'ImageOrientationPatient',
  InstanceNumber: 'InstanceNumber',
  PixelSpacing: 'PixelSpacing',
  Rows: 'Rows',
  Columns: 'Columns',
  BitsStored: 'BitsStored',
  BitsAllocated: 'BitsAllocated',
  PixelRepresentation: 'PixelRepresentation',
  SamplesPerPixel: 'SamplesPerPixel',
  RescaleIntercept: 'RescaleIntercept',
  RescaleSlope: 'RescaleSlope',
  NumberOfFrames: 'NumberOfFrames',
  PatientID: 'PatientId',
  PatientName: 'PatientName',
  PatientBirthDate: 'PatientBirthDate',
  PatientSex: 'PatientSex',
  StudyID: 'StudyInstanceUID',
  StudyInstanceUID: 'StudyInstanceUID',
  StudyDate: 'StudyDate',
  StudyTime: 'StudyTime',
  AccessionNumber: 'AccessionNumber',
  StudyDescription: 'StudyDescription',
  Modality: 'Modality',
  SeriesInstanceUID: 'SeriesInstanceUID',
  SeriesNumber: 'SeriesNumber',
  SeriesDescription: 'SeriesDescription',
  WindowLevel: 'WindowCenter',
  WindowWidth: 'WindowWidth',
} as const satisfies NameToMeta;

function getChunkId(chunk: Chunk) {
  const metadata = Object.fromEntries(chunk.metadata!);
  const SOPInstanceUID = metadata[nameToMetaKey.SOPInstanceUID];
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

export async function dicomSliceToImageUri(blob: Blob) {
  const array = await blob.arrayBuffer();
  const uint8Array = new Uint8Array(array);
  const result = await decode(uint8Array, {
    webWorker: getWorker(),
  });
  return itkImageToURI(result.image);
}

export default class AhiChunkImage implements ChunkImage {
  protected chunks: Chunk[];
  private chunkListeners: Array<() => void>;
  private thumbnailCache: WeakMap<Chunk, Promise<unknown>>;
  private events: Emitter<ChunkImageEvents>;
  public imageData: Maybe<vtkImageData>;
  public dataId: string;
  public chunkStatus: Ref<ChunkStatus[]>;
  public isLoading: ComputedRef<boolean>;
  public seriesMeta: Record<string, string>;

  constructor(seriesMeta: Record<string, string>) {
    this.seriesMeta = seriesMeta;
    this.dataId = seriesMeta.SeriesInstanceUID;
    this.chunks = [];
    this.chunkListeners = [];
    this.chunkStatus = ref([]);
    this.isLoading = computed(() =>
      this.chunkStatus.value.some(
        (status) =>
          status !== ChunkStatus.Loaded && status !== ChunkStatus.Errored
      )
    );
    this.thumbnailCache = new WeakMap();
    this.events = mitt();
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
    this.unregisterChunkListeners();
    this.events.all.clear();
    this.chunks.length = 0;
    this.imageData = null;
    this.chunkStatus.value = [];
    this.thumbnailCache = new WeakMap();
  }

  startLoad() {
    this.chunks.forEach((chunk) => {
      chunk.loadData();
    });
  }

  stopLoad() {
    this.chunks.forEach((chunk) => {
      chunk.stopLoad();
    });
  }

  async addChunks(chunks: Chunk[]) {
    await Promise.all(chunks.map((chunk) => chunk.loadMeta()));
    const existingIds = new Set(this.chunks.map((chunk) => getChunkId(chunk)));
    chunks
      .filter((chunk) => !existingIds.has(getChunkId(chunk)))
      .forEach((chunk) => {
        this.chunks.push(chunk);
      });

    this.unregisterChunkListeners();

    // this.chunks = sort(this.chunks);

    this.chunkStatus.value = this.chunks.map((chunk) => {
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

    this.registerChunkListeners();
    this.processChunks();
    this.reallocateImage();

    // TODO somehow link the volume key + dataset files in fileStore for files
    this.updateImageStore();
    // should be updated after the image store so that we get an imageId.
    this.updateDicomStore();
  }

  getThumbnail(strategy: ThumbnailStrategy): Promise<any> {
    if (strategy !== ThumbnailStrategy.MiddleSlice)
      throw new Error('Can only handle MiddleSlice thumbnailing strategy');

    const middle = Math.floor(this.chunks.length / 2);
    const chunk = this.chunks[middle];

    if (!this.thumbnailCache.has(chunk)) {
      // NOTE(fli): if chunk changes, the old promise is not cancelled
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

  private processChunks() {
    this.chunks
      .filter((chunk): chunk is Chunk & { dataBlob: Blob } => !!chunk.dataBlob)
      .forEach((_, idx) => {
        this.onChunkHasData(idx);
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
    this.imageData?.delete();
    this.imageData = allocateImageFromChunks(nameToMetaKey, this.chunks);
  }

  private async onChunkHasData(chunkIndex: number) {
    if (!this.imageData) return;

    const chunk = this.chunks[chunkIndex];
    if (!chunk.dataBlob) throw new Error('Chunk does not have data');

    const array = await chunk.dataBlob.arrayBuffer();
    const uint8Array = new Uint8Array(array);
    const result = await decode(uint8Array, {
      webWorker: getWorker(),
    });
    if (!result.image.data) throw new Error('No data read from chunk');

    const meta = new Map(chunk.metadata);
    const rescaleInterceptMeta = meta.get(nameToMetaKey.RescaleIntercept);
    const rescaleIntercept = rescaleInterceptMeta
      ? Number(rescaleInterceptMeta)
      : 0;
    const pixels = result.image.data as unknown as number[];
    for (let i = 0; i < pixels.length; i++) {
      pixels[i] += rescaleIntercept;
    }

    const scalars = this.imageData.getPointData().getScalars();
    const pixelData = scalars.getData() as TypedArray;

    const dims = this.imageData.getDimensions();
    const offset =
      dims[0] * dims[1] * scalars.getNumberOfComponents() * chunkIndex;
    pixelData.set(result.image.data as TypedArray, offset);

    const rangeAlreadyInitialized = this.chunkStatus.value.some(
      (status) => status === ChunkStatus.Loaded
    );

    // update the data range
    for (let comp = 0; comp < scalars.getNumberOfComponents(); comp++) {
      const { min, max } = fastComputeRange(
        // TODO(fli): fastComputeRange first param should be ArrayLike<number>
        result.image.data as unknown as number[],
        comp,
        scalars.getNumberOfComponents()
      );

      const curRange = scalars.getRange(comp);

      const newMin = rangeAlreadyInitialized ? Math.min(min, curRange[0]) : min;
      const newMax = rangeAlreadyInitialized ? Math.max(max, curRange[1]) : max;
      scalars.setRange({ min: newMin, max: newMax }, comp);
    }

    this.events.emit('chunkLoaded', {
      chunk,
      updatedExtent: [0, dims[0] - 1, 0, dims[1] - 1, chunkIndex, chunkIndex],
    });

    this.chunkStatus.value[chunkIndex] = ChunkStatus.Loaded;

    this.imageData.modified();

    const loaded = this.chunkStatus.value.every(
      (status) => status === ChunkStatus.Loaded
    );
    if (loaded) {
      console.timeEnd(`load time`);
    }
  }

  private onChunkErrored(chunkIndex: number, err: unknown) {
    this.events.emit('chunkErrored', {
      chunk: this.chunks[chunkIndex],
      error: err,
    });
    this.chunkStatus.value[chunkIndex] = ChunkStatus.Errored;
  }

  private updateDicomStore() {
    if (this.chunks.length === 0) return;

    const firstChunk = this.chunks[0];
    if (!firstChunk.metadata)
      throw new Error('Chunk does not have metadata loaded');
    const metadata = Object.fromEntries(firstChunk.metadata);

    const store = useDICOMStore();
    const patientInfo: PatientInfo = {
      PatientID: metadata[nameToMetaKey.PatientID],
      PatientName: metadata[nameToMetaKey.PatientName],
      PatientBirthDate: metadata[nameToMetaKey.PatientBirthDate],
      PatientSex: metadata[nameToMetaKey.PatientSex],
    };

    const studyInfo: StudyInfo = {
      StudyID: metadata[nameToMetaKey.StudyID],
      StudyInstanceUID: metadata[nameToMetaKey.StudyInstanceUID],
      StudyDate: metadata[nameToMetaKey.StudyDate],
      StudyTime: metadata[nameToMetaKey.StudyTime],
      AccessionNumber: metadata[nameToMetaKey.AccessionNumber],
      StudyDescription: metadata[nameToMetaKey.StudyDescription],
    };

    const volumeInfo: VolumeInfo = {
      NumberOfSlices: this.chunks.length,
      VolumeID: this.dataId,
      Modality: metadata[nameToMetaKey.Modality],
      SeriesInstanceUID: metadata[nameToMetaKey.SeriesInstanceUID],
      SeriesNumber: metadata[nameToMetaKey.SeriesNumber],
      SeriesDescription: metadata[nameToMetaKey.SeriesDescription],
      // @ts-expect-error
      WindowLevel: metadata[nameToMetaKey.WindowLevel]?.join('\\'),
      // @ts-expect-error
      WindowWidth: metadata[nameToMetaKey.WindowWidth]?.join('\\'),
    };

    store._updateDatabase(patientInfo, studyInfo, volumeInfo);
  }

  private updateImageStore() {
    if (!this.imageData || !this.dataId) return;

    const store = useImageStore();
    if (this.dataId in store.dataIndex) {
      store.updateData(this.dataId, this.imageData);
    } else {
      store.addVTKImageData('DICOM image', this.imageData, this.dataId);
    }
  }
}
