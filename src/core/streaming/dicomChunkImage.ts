import { readVolumeSlice, splitAndSort } from '@/src/io/dicom';
import { Chunk, waitForChunkState } from '@/src/core/streaming/chunk';
import { Image, readImage } from '@itk-wasm/image-io';
import { getWorker } from '@/src/io/itk/worker';
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
import { Tags } from '@/src/core/dicomTags';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { ChunkState } from '@/src/core/streaming/chunkStateMachine';
import { ChunkImage, ThumbnailStrategy } from '@/src/core/streaming/chunkImage';
import { ComputedRef, Ref, computed, ref } from 'vue';

const { fastComputeRange } = vtkDataArray;

export enum DicomChunkStatus {
  NotLoaded,
  Loading,
  Loaded,
}

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

export default class DicomChunkImage implements ChunkImage {
  protected chunks: Chunk[];
  private chunkListeners: Array<() => void>;
  private thumbnailPromises: WeakMap<Chunk, Promise<unknown>>;
  public imageData: Maybe<vtkImageData>;
  public dataId: Maybe<string>;
  public chunkStatus: Ref<DicomChunkStatus[]>;
  public isLoading: ComputedRef<boolean>;

  constructor() {
    this.chunks = [];
    this.chunkListeners = [];
    this.dataId = null;
    this.chunkStatus = ref([]);
    this.isLoading = computed(() =>
      this.chunkStatus.value.some(
        (status) => status !== DicomChunkStatus.Loaded
      )
    );
    this.thumbnailPromises = new WeakMap();
  }

  dispose() {
    this.unregisterChunkListeners();
    this.chunks.length = 0;
    this.imageData = null;
    this.dataId = null;
    this.chunkStatus.value = [];
    this.thumbnailPromises = new WeakMap();
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

    const chunksByVolume = await splitAndSort(
      this.chunks,
      (chunk) => chunk.metaBlob!
    );
    const volumes = Object.entries(chunksByVolume);
    if (volumes.length !== 1)
      throw new Error('Did not get just a single volume!');

    this.unregisterChunkListeners();

    // save the newly sorted chunk order
    [this.dataId, this.chunks] = volumes[0];

    this.chunkStatus.value = this.chunks.map((chunk) => {
      switch (chunk.state) {
        case ChunkState.Init:
        case ChunkState.MetaLoading:
        case ChunkState.MetaOnly:
          return DicomChunkStatus.NotLoaded;
        case ChunkState.DataLoading:
          return DicomChunkStatus.Loading;
        case ChunkState.Loaded:
          return DicomChunkStatus.Loaded;
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

    if (!this.thumbnailPromises.has(chunk)) {
      // NOTE(fli): if chunk changes, the old promise is not cancelled
      this.thumbnailPromises.set(
        chunk,
        waitForChunkState(chunk, ChunkState.Loaded).then((ch) => {
          if (!ch.dataBlob) throw new Error('No chunk data');
          return dicomSliceToImageUri(ch.dataBlob);
        })
      );
    }
    return this.thumbnailPromises.get(chunk)!;
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
        return chunk.addEventListener('doneData', () => {
          this.onChunkHasData(index);
        });
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
    this.imageData = allocateImageFromChunks(this.chunks);
  }

  private async onChunkHasData(chunkIndex: number) {
    if (!this.imageData) return;

    const rangeAlreadyInitialized = this.chunkStatus.value.some(
      (status) => status === DicomChunkStatus.Loaded
    );
    this.chunkStatus.value[chunkIndex] = DicomChunkStatus.Loaded;

    const chunk = this.chunks[chunkIndex];
    if (!chunk.dataBlob) throw new Error('Chunk does not have data');
    const result = await readImage(new File([chunk.dataBlob], 'file.dcm'), {
      webWorker: getWorker(),
    });

    if (!result.image.data) throw new Error('No data read from chunk');

    const scalars = this.imageData.getPointData().getScalars();
    const pixelData = scalars.getData() as TypedArray;

    const dims = this.imageData.getDimensions();
    const offset =
      dims[0] * dims[1] * scalars.getNumberOfComponents() * chunkIndex;
    pixelData.set(result.image.data as TypedArray, offset);

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

    scalars.modified();
    this.imageData.modified();
  }

  private updateDicomStore() {
    if (this.chunks.length === 0) return;

    const firstChunk = this.chunks[0];
    if (!firstChunk.metadata)
      throw new Error('Chunk does not have metadata loaded');
    const metadata = Object.fromEntries(firstChunk.metadata);

    const store = useDICOMStore();
    const patientInfo: PatientInfo = {
      PatientID: metadata[Tags.PatientID],
      PatientName: metadata[Tags.PatientName],
      PatientBirthDate: metadata[Tags.PatientBirthDate],
      PatientSex: metadata[Tags.PatientSex],
    };

    const studyInfo: StudyInfo = {
      StudyID: metadata[Tags.StudyID],
      StudyInstanceUID: metadata[Tags.StudyInstanceUID],
      StudyDate: metadata[Tags.StudyDate],
      StudyTime: metadata[Tags.StudyTime],
      AccessionNumber: metadata[Tags.AccessionNumber],
      StudyDescription: metadata[Tags.StudyDescription],
    };

    const volumeInfo: VolumeInfo = {
      NumberOfSlices: this.chunks.length,
      VolumeID: this.dataId ?? '',
      Modality: metadata[Tags.Modality],
      SeriesInstanceUID: metadata[Tags.SeriesInstanceUID],
      SeriesNumber: metadata[Tags.SeriesNumber],
      SeriesDescription: metadata[Tags.SeriesDescription],
      WindowLevel: metadata[Tags.WindowLevel],
      WindowWidth: metadata[Tags.WindowWidth],
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
