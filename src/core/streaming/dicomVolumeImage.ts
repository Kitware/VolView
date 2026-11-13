import { computed } from 'vue';
import mitt from 'mitt';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { JsonCompatible } from '@itk-wasm/image-io';
import {
  getDatasetModality,
  loadVolume,
  middleSlot,
  readBytes,
  type DicomRuntime,
  type Extent,
  type Instance,
  type Volume,
  type VolumeUpdate,
} from '@/packages/dicom/core';
import {
  applyVolumeUpdate,
  encodeThumbnailToUri,
  sliceThumbnail,
  toVtkImageData,
  type ThumbnailSlice,
} from '@/packages/dicom/vtk';
import {
  BaseProgressiveImage,
  type ProgressiveImageEvents,
} from '@/src/core/progressiveImage';
import {
  readDicomSegmentation,
  type ReadOverlappingSegmentationMeta,
} from '@/src/io/dicom';
import { convertItkToVtkImage } from '@/src/io/convertItkToVtkImage';
import { useDicomRuntimeStore } from '@/src/store/dicom-runtime';
import { abortError, ensureError } from '@/src/utils';

export type DicomVolumeImageEvents = ProgressiveImageEvents & {
  /** A decoded region of the current image, as an inclusive extent. */
  extentLoaded: Extent;
};

type SegmentationResult = {
  image: vtkImageData;
  metadata: JsonCompatible & ReadOverlappingSegmentationMeta;
};

export type DicomVolumeImageInit = {
  runtime?: Pick<
    DicomRuntime,
    'decoders' | 'decodeConcurrency' | 'readConcurrency' | 'signal'
  >;
  readSegmentation?: (file: File) => Promise<SegmentationResult>;
  encodeThumbnail?: (slice: ThumbnailSlice) => string;
  /** The slice the user is looking at, loaded first; undefined for the middle. */
  focus?: () => number | undefined;
};

type Content =
  | { kind: 'volume'; volume: Volume; failed: Set<number> }
  | {
      kind: 'segmentation';
      instances: readonly Instance[];
      loaded: boolean;
    };

const readSegmentationFile = async (file: File) => {
  const result = await readDicomSegmentation(file);
  return {
    image: convertItkToVtkImage(result.outputImage),
    metadata: result.metaInfo,
  };
};

/** `failed` holds slices, so a frame that failed settles on its own. */
function volumeSettled({ volume, failed }: Content & { kind: 'volume' }) {
  return volume.loaded.every(
    (isLoaded, slice) => isLoaded === 1 || failed.has(slice)
  );
}

const contentComplete = (content: Content | null) => {
  if (!content) return false;
  if (content.kind === 'segmentation') return content.loaded;
  return volumeSettled(content) && content.volume.loaded.includes(1);
};

// Nothing is left to read, so starting a load would only flicker `loading`.
const fullyLoaded = (content: Content) =>
  content.kind === 'segmentation'
    ? content.loaded
    : content.volume.loaded.every((isLoaded) => isLoaded === 1);

// The loaded slice nearest the middle, once loading can add no more.
function fallbackSlice(volume: Volume) {
  const middle = middleSlot(volume);
  const loaded = [...volume.loaded.keys()].filter(
    (slice) => volume.loaded[slice] === 1
  );
  if (!loaded.length) return null;
  return loaded.reduce((best, slice) =>
    Math.abs(slice - middle) < Math.abs(best - middle) ? slice : best
  );
}

/**
 * The app's handle on one DICOM dataset: the current volume, its vtkImageData
 * and the one load that fills it. A new volume replaces the image and
 * restarts loading; disposing aborts it.
 */
export default class DicomVolumeImage extends BaseProgressiveImage {
  private content: Content | null = null;

  private load: AbortController | null = null;

  private disposed = false;

  private thumbnail: Promise<string | null> | null = null;

  /** Settles the pending thumbnail once its slice is known; null when none is pending. */
  private settleThumbnail: (() => void) | null = null;

  private readonly events = mitt<DicomVolumeImageEvents>();

  private readonly init: Required<Omit<DicomVolumeImageInit, 'focus'>> &
    Pick<DicomVolumeImageInit, 'focus'>;

  public segBuildInfo:
    | (JsonCompatible & ReadOverlappingSegmentationMeta)
    | null = null;

  constructor(init: DicomVolumeImageInit = {}) {
    super();
    this.init = {
      ...init,
      runtime: init.runtime ?? useDicomRuntimeStore().runtime,
      readSegmentation: init.readSegmentation ?? readSegmentationFile,
      encodeThumbnail: init.encodeThumbnail ?? encodeThumbnailToUri,
    };
    this.loaded = computed(
      () => !this.loading.value && this.status.value === 'complete'
    );
  }

  /** The instances the current image is built from, in planned order. */
  getInstances(): readonly Instance[] {
    if (!this.content) return [];
    return this.content.kind === 'volume'
      ? this.content.volume.members
      : this.content.instances;
  }

  /** The volume being shown, or null before one is set and for SEG. */
  getVolume() {
    return this.content?.kind === 'volume' ? this.content.volume : null;
  }

  getModality() {
    return getDatasetModality(this.getInstances()[0]?.dataset);
  }

  /** Shows a newly allocated volume; slices it already holds stay loaded. */
  setVolume(volume: Volume) {
    this.replaceContent({ kind: 'volume', volume, failed: new Set() });
    this.spatialMetadata.value = volume.spatialMetadata;
    this.replaceImage(toVtkImageData(volume));
    this.settleThumbnail?.();
  }

  /** A SEG object, which the segmentation reader turns into a labelmap. */
  setSegmentation(instances: readonly Instance[]) {
    this.replaceContent({ kind: 'segmentation', instances, loaded: false });
    this.settleThumbnail?.();
  }

  startLoad() {
    const { content } = this;
    if (this.disposed || this.load || !content || fullyLoaded(content)) return;
    const controller = new AbortController();
    this.load = controller;
    this.setLoading(true);
    const run =
      content.kind === 'volume'
        ? this.loadPixels(content, controller.signal)
        : this.loadSegmentation(content, controller.signal);
    run
      .catch((error) => {
        if (!controller.signal.aborted)
          this.events.emit('error', ensureError(error));
      })
      .finally(() => {
        if (this.load !== controller) return;
        this.load = null;
        this.setLoading(false);
      });
  }

  stopLoad() {
    this.load?.abort(abortError('DICOM loading stopped'));
    this.load = null;
    this.setLoading(false);
  }

  getThumbnail(): Promise<string | null> {
    if (this.disposed) return Promise.reject(abortError('Image disposed'));
    this.thumbnail ??= new Promise((resolve, reject) => {
      this.settleThumbnail = () => {
        const slice = this.disposed ? null : this.thumbnailSlice();
        if (slice === undefined) return;
        this.settleThumbnail = null;
        if (this.disposed) reject(abortError('Image disposed'));
        else if (slice === null) resolve(null);
        else
          resolve(
            this.init.encodeThumbnail(
              sliceThumbnail(this.vtkImageData.value, slice)
            )
          );
      };
      this.settleThumbnail();
    });
    return this.thumbnail;
  }

  addEventListener<T extends keyof DicomVolumeImageEvents>(
    type: T,
    callback: (info: DicomVolumeImageEvents[T]) => void
  ) {
    this.events.on(type, callback);
  }

  removeEventListener<T extends keyof DicomVolumeImageEvents>(
    type: T,
    callback: (info: DicomVolumeImageEvents[T]) => void
  ) {
    this.events.off(type, callback);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.load?.abort(abortError('Image disposed'));
    this.load = null;
    this.settleThumbnail?.();
    this.events.all.clear();
    super.dispose();
    this.vtkImageData.value.delete();
  }

  private replaceContent(content: Content) {
    this.stopLoad();
    this.content = content;
    // A pending thumbnail settles from the new content instead.
    if (!this.settleThumbnail) this.thumbnail = null;
    this.segBuildInfo = null;
    this.updateStatus();
  }

  private replaceImage(image: vtkImageData) {
    const previous = this.vtkImageData.value;
    this.vtkImageData.value = image;
    if (previous !== image) previous.delete();
  }

  // Nothing is left to read, so a later startLoad may begin a retry at once.
  private finishLoad() {
    this.load = null;
    this.setLoading(false);
  }

  private setLoading(loading: boolean) {
    if (this.loading.value === loading) return;
    this.loading.value = loading;
    this.events.emit('loading', loading);
    this.settleThumbnail?.();
  }

  private updateStatus() {
    const status = contentComplete(this.content) ? 'complete' : 'incomplete';
    if (this.status.value === status) return;
    this.status.value = status;
    this.events.emit('status', status);
  }

  /** Undefined while the slice to show may still load; null for none. */
  private thumbnailSlice() {
    const { content } = this;
    if (!content) return undefined;
    if (content.kind === 'segmentation') return content.loaded ? 0 : undefined;
    const middle = middleSlot(content.volume);
    if (content.volume.loaded[middle]) return middle;
    if (!volumeSettled(content)) return undefined;
    return fallbackSlice(content.volume);
  }

  private onUpdate(
    content: Content & { kind: 'volume' },
    image: vtkImageData,
    update: VolumeUpdate
  ) {
    if ('error' in update) {
      const [, , , , first, last] = update.extent;
      for (let slice = first; slice <= last; slice += 1)
        content.failed.add(slice);
      this.events.emit('error', update.error);
    } else {
      applyVolumeUpdate(image, update);
      this.events.emit('extentLoaded', update.extent);
    }
    // Consumers read complete together with not loading, as one transition.
    if (volumeSettled(content)) this.finishLoad();
    this.updateStatus();
    this.settleThumbnail?.();
  }

  private async loadPixels(
    content: Content & { kind: 'volume' },
    signal: AbortSignal
  ) {
    const { volume } = content;
    const image = this.vtkImageData.value;
    content.failed.clear();
    const updates = loadVolume(volume, {
      runtime: this.init.runtime,
      signal,
      focus: () => this.init.focus?.() ?? middleSlot(volume),
    });
    for await (const update of updates) {
      // An update yielded just before the abort still reaches this body.
      if (signal.aborted) return;
      this.onUpdate(content, image, update);
    }
  }

  private async loadSegmentation(
    content: Content & { kind: 'segmentation' },
    signal: AbortSignal
  ) {
    if (content.instances.length !== 1)
      throw new Error(
        `Cannot handle multiple SEG files. Expected 1, got ${content.instances.length}`
      );
    const bytes = await readBytes(content.instances[0].source, signal);
    const result = await this.init.readSegmentation(
      new File([bytes as BlobPart], 'seg.dcm')
    );
    if (signal.aborted) {
      result.image.delete();
      return;
    }
    this.segBuildInfo = result.metadata;
    this.replaceImage(result.image);
    content.loaded = true;
    this.finishLoad();
    this.updateStatus();
    this.settleThumbnail?.();
  }
}
