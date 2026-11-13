// Backing image for multi-frame ultrasound DICOM clips. Owns a single 2D
// vtkImageData with 3-component RGB scalars; the per-frame stored bytes are
// read once loading starts and decoded frames live in an LRU cache.

import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import mitt, { Emitter } from 'mitt';
import { computed } from 'vue';

import {
  BaseProgressiveImage,
  ProgressiveImageEvents,
} from '@/src/core/progressiveImage';
import {
  fallbackSpacing,
  physicalSpacing,
  unitToMm,
  type Instance,
  type SpatialMetadata,
} from '@/packages/dicom/core';
import { abortError } from '@/src/utils';
import {
  type CineHeader,
  isNativeTransferSyntax,
  isSupportedCineTransferSyntax,
  readCineFrames,
  readCineHeader,
} from './cineInstance';
import {
  DecodedFrame,
  FrameCache,
  copyDecodedFrameToRgb,
  decodeJpegFrame,
  decodeNativeFrame,
} from './frameCache';

function spatialRegionSpacing(r: CineHeader['regions'][number]) {
  const sx = unitToMm(r.physicalUnitsXDirection);
  const sy = unitToMm(r.physicalUnitsYDirection);
  if (sx == null || sy == null) return null;
  const { physicalDeltaX: dx, physicalDeltaY: dy } = r;
  if (!dx || !dy || !Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  return [
    physicalSpacing(
      Math.abs(dx) * sx,
      'Ultrasound region (cm converted to mm)'
    ),
    physicalSpacing(
      Math.abs(dy) * sy,
      'Ultrasound region (cm converted to mm)'
    ),
  ] as const;
}

function pickSpacing(header: CineHeader): SpatialMetadata {
  const z = fallbackSpacing(
    'Cine frames share one image plane; this is not a spatial frame step.'
  );
  for (const r of header.regions) {
    const spacing = spatialRegionSpacing(r);
    if (!spacing) continue;
    return {
      axes: [...spacing, z],
      notes: [
        'Physical spacing applies within the first spatial ultrasound region, not necessarily the entire image.',
      ],
    };
  }

  if (header.pixelSpacing) {
    const [rowSpacing, columnSpacing] = header.pixelSpacing;
    return {
      axes: [
        physicalSpacing(columnSpacing, 'PixelSpacing'),
        physicalSpacing(rowSpacing, 'PixelSpacing'),
        z,
      ],
      notes: [],
    };
  }

  return {
    axes: [
      fallbackSpacing(
        'No usable spatial ultrasound region or PixelSpacing is supplied.'
      ),
      fallbackSpacing(
        'No usable spatial ultrasound region or PixelSpacing is supplied.'
      ),
      z,
    ],
    notes: [],
  };
}

/** Encodes an RGB frame as a PNG data URI, or null without a 2D canvas. */
function encodeFrameToUri({ width, height, rgb }: DecodedFrame) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const image = context.createImageData(width, height);
  const rgba = image.data;
  for (let pixel = 0; pixel < width * height; pixel++) {
    rgba[pixel * 4] = rgb[pixel * 3];
    rgba[pixel * 4 + 1] = rgb[pixel * 3 + 1];
    rgba[pixel * 4 + 2] = rgb[pixel * 3 + 2];
    rgba[pixel * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

export default class DicomCineImage extends BaseProgressiveImage {
  public readonly header: CineHeader;

  private readonly instance: Instance;
  private frames: Promise<Uint8Array[]> | null = null;
  private readonly reads = new AbortController();
  private readonly cache: FrameCache;
  private readonly inFlightFrames: Map<number, Promise<DecodedFrame>>;
  private readonly events: Emitter<ProgressiveImageEvents>;
  private readonly scalarBuffer: Uint8Array;

  private readonly reported = new WeakSet<Error>();

  private readonly encodeThumbnail: (frame: DecodedFrame) => string | null;
  private thumbnailPromise: Promise<string | null> | null = null;
  private disposed = false;

  constructor(
    instance: Instance,
    header = readCineHeader(instance),
    encodeThumbnail: (frame: DecodedFrame) => string | null = encodeFrameToUri
  ) {
    super();

    this.encodeThumbnail = encodeThumbnail;
    this.header = header;
    this.instance = instance;
    this.cache = new FrameCache();
    this.inFlightFrames = new Map();
    this.events = mitt();

    // Build the single 2D vtkImageData. 3-component RGB uint8.
    const { cols, rows } = header;
    if (!cols || !rows) {
      throw new Error('Cine DICOM has invalid Rows/Columns');
    }
    this.scalarBuffer = new Uint8Array(cols * rows * 3);
    const imageData = vtkImageData.newInstance();
    imageData.setExtent([0, cols - 1, 0, rows - 1, 0, 0]);
    this.spatialMetadata.value = pickSpacing(header);
    imageData.setSpacing(
      this.spatialMetadata.value.axes.map((axis) => axis.value)
    );
    imageData.setOrigin([0, 0, 0]);
    imageData.setDirection([1, 0, 0, 0, 1, 0, 0, 0, 1]);

    const scalars = vtkDataArray.newInstance({
      numberOfComponents: 3,
      values: this.scalarBuffer,
    });
    scalars.setRange({ min: 0, max: 255 }, 0);
    scalars.setRange({ min: 0, max: 255 }, 1);
    scalars.setRange({ min: 0, max: 255 }, 2);
    imageData.getPointData().setScalars(scalars);

    this.vtkImageData.value = imageData;

    // Status flips to 'complete' once the first frame is decoded in startLoad().
    this.status.value = 'incomplete';
    this.loaded = computed(
      () => !this.loading.value && this.status.value === 'complete'
    );

    this.events.on('loading', (loading) => {
      this.loading.value = loading;
    });
    this.events.on('status', (status) => {
      this.status.value = status;
    });
  }

  addEventListener<T extends keyof ProgressiveImageEvents>(
    type: T,
    callback: (info: ProgressiveImageEvents[T]) => void
  ): void {
    this.events.on(type, callback);
  }

  removeEventListener<T extends keyof ProgressiveImageEvents>(
    type: T,
    callback: (info: ProgressiveImageEvents[T]) => void
  ): void {
    this.events.off(type, callback);
  }

  startLoad(): void {
    // Decode frame 0 so the canonical vtkImageData has valid scalars for
    // consumers that read it synchronously (thumbnail, getVtkImageData).
    if (this.disposed) return;
    if (!isSupportedCineTransferSyntax(this.header.transferSyntaxUID)) {
      this.reportError(
        new Error(
          `Unsupported cine transfer syntax: ${this.header.transferSyntaxUID}`
        )
      );
      return;
    }
    this.events.emit('loading', true);
    this.getFrame(0)
      .then((frame) => {
        if (this.disposed) return;
        copyDecodedFrameToRgb(frame, this.scalarBuffer);
        this.vtkImageData.value.getPointData().getScalars().modified();
        this.vtkImageData.value.modified();
        this.events.emit('status', 'complete');
        this.events.emit('loading', false);
      })
      .catch(() => {
        // getFrame already routed the error through reportError.
      });
  }

  stopLoad(): void {
    // Nothing to interrupt — frames are decoded one at a time on demand.
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.reads.abort(abortError('Image disposed'));
    super.dispose();
    this.events.all.clear();
    this.cache.clear();
    this.inFlightFrames.clear();
    this.frames = null;
    this.vtkImageData.value.delete();
  }

  getNumberOfFrames(): number {
    return this.header.numberOfFrames;
  }

  getThumbnail(): Promise<string | null> {
    if (this.disposed) return Promise.resolve(null);
    if (this.thumbnailPromise) return this.thumbnailPromise;
    const thumbnail = (async () => {
      try {
        return this.encodeThumbnail(await this.getFrame(0));
      } catch {
        return null;
      }
    })();
    this.thumbnailPromise = thumbnail;
    // A failed read is not cached, so a later call tries again.
    thumbnail.then((uri) => {
      if (uri === null && this.thumbnailPromise === thumbnail)
        this.thumbnailPromise = null;
    });
    return thumbnail;
  }

  // Concurrent requests for the same uncached frame share a single decode.
  async getFrame(frameIndex: number): Promise<DecodedFrame> {
    if (this.disposed) {
      throw new Error('DicomCineImage is disposed');
    }
    const clamped = Math.max(
      0,
      Math.min(this.header.numberOfFrames - 1, frameIndex | 0)
    );

    // Keep cache warm during forward playback when the clip exceeds the cache budget.
    this.prefetchNext(clamped);

    const cached = this.cache.get(clamped);
    if (cached) return cached;

    return this.scheduleDecode(clamped);
  }

  private prefetchNext(currentFrame: number): void {
    const total = this.header.numberOfFrames;
    if (total <= 1) return;
    const next = (currentFrame + 1) % total;
    if (this.cache.has(next) || this.inFlightFrames.has(next)) return;
    this.scheduleDecode(next).catch(() => {});
  }

  private scheduleDecode(frameIndex: number): Promise<DecodedFrame> {
    const inFlight = this.inFlightFrames.get(frameIndex);
    if (inFlight) return inFlight;

    const decodePromise = (async () => {
      try {
        const decoded = await this.decode(frameIndex);
        if (this.disposed) {
          throw new Error('DicomCineImage is disposed');
        }
        this.cache.set(frameIndex, decoded);
        return decoded;
      } catch (err) {
        if (!this.disposed) {
          this.reportError(err);
        }
        throw err;
      } finally {
        this.inFlightFrames.delete(frameIndex);
      }
    })();

    this.inFlightFrames.set(frameIndex, decodePromise);
    return decodePromise;
  }

  // Clear the loading flag too — otherwise the spinner persists past a bad
  // first-frame decode.
  private reportError(err: unknown): void {
    const error = err instanceof Error ? err : new Error(String(err));
    // Every frame waiting on one failed read rejects with the same error.
    if (this.reported.has(error)) return;
    this.reported.add(error);
    this.events.emit('error', error);
    if (this.loading.value) {
      this.events.emit('loading', false);
    }
  }

  // A failed read is forgotten, so the next load reads again.
  private readFrames() {
    this.frames ??= readCineFrames(
      this.instance,
      this.header,
      this.reads.signal
    ).catch((err) => {
      this.frames = null;
      throw err;
    });
    return this.frames;
  }

  private async decode(frameIndex: number) {
    const bytes = (await this.readFrames())[frameIndex];
    if (!bytes) throw new Error(`Frame ${frameIndex} is missing`);
    if (!isNativeTransferSyntax(this.header.transferSyntaxUID)) {
      return decodeJpegFrame(bytes, this.header.cols, this.header.rows);
    }
    return decodeNativeFrame(bytes, {
      width: this.header.cols,
      height: this.header.rows,
      samplesPerPixel: this.header.samplesPerPixel,
      photometric: this.header.photometricInterpretation,
      planarConfiguration: this.header.planarConfiguration,
    });
  }
}
