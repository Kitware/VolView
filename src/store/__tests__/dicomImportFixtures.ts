import { ref } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { SOP_CLASS_ULTRASOUND_MULTIFRAME, Tags } from '@/src/core/dicomTags';
import { defaultImageMetadata } from '@/src/core/progressiveImage';
import type { Chunk } from '@/src/core/streaming/chunk';
import type DicomChunkImage from '@/src/core/streaming/dicomChunkImage';

export const SERIES_UID = '1.2.826.0.1.3680043.9.7';
export const OTHER_SERIES_UID = '1.2.826.0.1.3680043.9.8';
export const STUDY_UID = '1.2.826.0.1.3680043.9.1';

type SliceOptions = {
  sop: string;
  series?: string;
  z?: number;
  rows?: string;
  orientation?: string;
  // Extra tags, keyed 'gggg|eeee', appended after the fixed ones.
  tags?: Record<string, string>;
};

/** One chunk's worth of metadata, as `readDicomTags` hands it back. */
export function chunkFor({
  sop,
  series = SERIES_UID,
  z = 0,
  rows = '4',
  orientation = '1\\0\\0\\0\\1\\0',
  tags = {},
}: SliceOptions) {
  const metadata = [
    [Tags.SOPClassUID, '1.2.840.10008.5.1.4.1.1.4'],
    [Tags.NumberOfFrames, '1'],
    [Tags.SOPInstanceUID, sop],
    [Tags.PatientID, 'patient-1'],
    [Tags.PatientName, 'Test Patient'],
    [Tags.PatientBirthDate, ''],
    [Tags.PatientSex, ''],
    [Tags.StudyID, 'study-1'],
    [Tags.StudyInstanceUID, STUDY_UID],
    [Tags.StudyDate, ''],
    [Tags.StudyTime, ''],
    [Tags.AccessionNumber, ''],
    [Tags.StudyDescription, ''],
    [Tags.Modality, 'MR'],
    [Tags.SeriesInstanceUID, series],
    [Tags.SeriesNumber, '7'],
    [Tags.SeriesDescription, 'Imported series'],
    [Tags.WindowLevel, ''],
    [Tags.WindowWidth, ''],
    [Tags.Rows, rows],
    [Tags.Columns, '4'],
    [Tags.SamplesPerPixel, '1'],
    [Tags.ImageOrientationPatient, orientation],
    [Tags.ImagePositionPatient, `0\\0\\${z}`],
    [Tags.InstanceNumber, String(z + 1)],
    ...Object.entries(tags),
  ] as Array<[string, string]>;
  return { metadata } as unknown as Chunk;
}

export type FakeImageHooks = {
  // Settles a candidate's preparation. Rejecting fails that candidate, never
  // resolving leaves it outstanding. Indexed by creation order.
  onPrepare?: (index: number, chunks: Chunk[]) => Promise<void>;
  // Runs inside the image cache's synchronous registration.
  onStartLoad?: (index: number) => void;
};

/** Records what the DICOM store asks a chunk volume to hold. */
export class FakeChunkImage {
  orientation: number[] | null = null;

  getOrientation() {
    return this.orientation;
  }

  setChunksCalls: Chunk[][] = [];

  startLoadCount = 0;

  disposeCount = 0;

  name = '';

  loading = ref(false);

  loaded = ref(true);

  private readonly imageData = vtkImageData.newInstance();

  constructor(
    private readonly index: number,
    private readonly hooks: FakeImageHooks = {}
  ) {}

  async setChunks(chunks: Chunk[], orientation: number[] | null) {
    await this.hooks.onPrepare?.(this.index, chunks);
    this.setChunksCalls.push(chunks);
    this.orientation = orientation;
  }

  getImageMetadata() {
    return defaultImageMetadata();
  }

  getVtkImageData() {
    return this.imageData;
  }

  getDicomMetadata() {
    return this.setChunksCalls.at(-1)![0].metadata;
  }

  getChunks() {
    return this.setChunksCalls.at(-1)!.slice();
  }

  setName(name: string) {
    this.name = name;
  }

  getStatus() {
    return 'incomplete';
  }

  isLoaded() {
    return false;
  }

  isLoading() {
    return false;
  }

  addEventListener() {}

  removeEventListener() {}

  startLoad() {
    this.startLoadCount += 1;
    this.hooks.onStartLoad?.(this.index);
  }

  dispose() {
    this.disposeCount += 1;
  }
}

export function imageFactory(hooks: FakeImageHooks = {}) {
  const created: FakeChunkImage[] = [];
  const createChunkImage = () => {
    const image = new FakeChunkImage(created.length, hooks);
    created.push(image);
    return image as unknown as DicomChunkImage;
  };
  return { created, createChunkImage };
}

export const sopOf = (chunk: Chunk) =>
  Object.fromEntries(chunk.metadata!)[Tags.SOPInstanceUID];

/** Lets every pending microtask and timer callback run. */
export const flush = () =>
  [...Array(5)].reduce(
    (chain) =>
      chain.then(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
          })
      ),
    Promise.resolve()
  );

/** A single ultrasound multi-frame instance, which the store routes to cine. */
export function cineChunkFor(sop: string, series = SERIES_UID) {
  const metadata = [
    [Tags.SOPClassUID, SOP_CLASS_ULTRASOUND_MULTIFRAME],
    [Tags.NumberOfFrames, '2'],
    [Tags.SOPInstanceUID, sop],
    [Tags.PatientID, 'patient-1'],
    [Tags.PatientName, 'Test Patient'],
    [Tags.StudyInstanceUID, STUDY_UID],
    [Tags.Modality, 'US'],
    [Tags.SeriesInstanceUID, series],
    [Tags.SeriesNumber, '7'],
    [Tags.SeriesDescription, 'Transactional cine'],
    [Tags.Rows, '2'],
    [Tags.Columns, '2'],
    [Tags.SamplesPerPixel, '1'],
  ] as Array<[string, string]>;
  return {
    metadata,
    dataBlob: new Blob([new Uint8Array(8)]),
    loadData: () => Promise.resolve(),
  } as unknown as Chunk;
}
