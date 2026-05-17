// Backing image for multi-frame ultrasound DICOM clips. Owns a single 2D
// vtkImageData with 3-component RGB scalars; the per-frame compressed bytes
// stay in this object and decoded frames live in an LRU cache.

import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import mitt, { Emitter } from 'mitt';
import { computed } from 'vue';

import {
  BaseProgressiveImage,
  ProgressiveImageEvents,
} from '@/src/core/progressiveImage';
import {
  CineHeader,
  CineParseResult,
  isNativeTransferSyntax,
  isSupportedCineTransferSyntax,
} from './parseCineDicom';
import {
  DecodedFrame,
  FrameCache,
  copyDecodedFrameToRgb,
  decodeJpegFrame,
  decodeNativeFrame,
} from './frameCache';
import { unitToMm } from '@/src/core/streaming/dicom/ultrasoundRegion';

function pickPixelSpacing(header: CineHeader): [number, number] {
  for (const r of header.regions) {
    const sx = r.physicalUnitsX != null ? unitToMm(r.physicalUnitsX) : null;
    const sy = r.physicalUnitsY != null ? unitToMm(r.physicalUnitsY) : null;
    if (sx == null || sy == null) continue;
    const { physicalDeltaX: dx, physicalDeltaY: dy } = r;
    if (!dx || !dy || !Number.isFinite(dx) || !Number.isFinite(dy)) continue;
    return [Math.abs(dx) * sx, Math.abs(dy) * sy];
  }
  return [1, 1];
}

export default class DicomCineImage extends BaseProgressiveImage {
  public readonly header: CineHeader;

  private readonly frames: Uint8Array[];
  private readonly encapsulated: boolean;
  private readonly cache: FrameCache;
  private readonly inFlightFrames: Map<number, Promise<DecodedFrame>>;
  private readonly events: Emitter<ProgressiveImageEvents>;
  private readonly scalarBuffer: Uint8Array;

  private thumbnailPromise: Promise<string | null> | null = null;
  private disposed = false;

  constructor(init: CineParseResult) {
    super();

    const { header, frames, encapsulated } = init;
    this.header = header;
    this.frames = frames;
    this.encapsulated = encapsulated;
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
    // Spacing falls back to 1 when no region declares a spatial unit, so
    // rulers report pixels (documented v1 behavior).
    const [spacingX, spacingY] = pickPixelSpacing(header);
    imageData.setSpacing([spacingX, spacingY, 1]);
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
    super.dispose();
    this.events.all.clear();
    this.cache.clear();
    this.inFlightFrames.clear();
    this.frames.length = 0;
    this.vtkImageData.value.delete();
  }

  getNumberOfFrames(): number {
    return this.header.numberOfFrames;
  }

  getThumbnail(): Promise<string | null> {
    if (this.disposed) return Promise.resolve(null);
    if (this.thumbnailPromise) return this.thumbnailPromise;
    this.thumbnailPromise = (async () => {
      try {
        const frame = await this.getFrame(0);
        const { cols, rows } = this.header;
        const canvas = document.createElement('canvas');
        canvas.width = cols;
        canvas.height = rows;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        const imageData = ctx.createImageData(cols, rows);
        const dst = imageData.data;
        const { rgb } = frame;
        const pixels = cols * rows;
        for (let i = 0; i < pixels; i++) {
          const s = i * 3;
          const d = i * 4;
          dst[d] = rgb[s];
          dst[d + 1] = rgb[s + 1];
          dst[d + 2] = rgb[s + 2];
          dst[d + 3] = 255;
        }
        ctx.putImageData(imageData, 0, 0);
        return canvas.toDataURL('image/png');
      } catch {
        return null;
      }
    })();
    return this.thumbnailPromise;
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
    this.events.emit('error', error);
    if (this.loading.value) {
      this.events.emit('loading', false);
    }
  }

  private async decode(frameIndex: number) {
    const bytes = this.frames[frameIndex];
    if (!bytes) throw new Error(`Frame ${frameIndex} is missing`);
    if (this.encapsulated) {
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

  static isSupported(header: CineHeader): boolean {
    if (!isSupportedCineTransferSyntax(header.transferSyntaxUID)) return false;
    if (isNativeTransferSyntax(header.transferSyntaxUID)) {
      // Native pixel data: only support 8-bit RGB or grayscale for v1.
      if (header.bitsAllocated !== 8) return false;
      const photometric = header.photometricInterpretation.trim();
      if (header.samplesPerPixel === 1) return photometric === 'MONOCHROME2';
      if (header.samplesPerPixel === 3) return photometric === 'RGB';
      return false;
    }
    return true;
  }
}
