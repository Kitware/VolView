// DicomCineImage — backing image for multi-frame ultrasound DICOM clips.
//
// Treats the clip as a normal VolView image selection: extends BaseProgressiveImage,
// owns a single 2D vtkImageData (extent [0, cols-1, 0, rows-1, 0, 0], 3-component
// RGB uint8 scalars), and swaps the scalars in-place whenever the selected frame
// changes. The original compressed frame bytes live in this object too, so we never
// hold all decoded frames at once — only the LRU's worth.

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
  decodeJpegFrame,
  decodeNativeFrame,
} from './frameCache';

// DICOM PhysicalUnits code 3 = centimetres. Other codes (dB, %, m/s, ...) are
// used for Doppler regions and aren't a length we can express as VTK spacing.
const PHYSICAL_UNITS_CM = 3;

function pickPixelSpacing(header: CineHeader): [number, number] {
  const region = header.regions[0];
  if (!region) return [1, 1];
  if (
    region.physicalUnitsX !== PHYSICAL_UNITS_CM ||
    region.physicalUnitsY !== PHYSICAL_UNITS_CM
  ) {
    return [1, 1];
  }
  const dx = region.physicalDeltaX;
  const dy = region.physicalDeltaY;
  if (!dx || !dy || !Number.isFinite(dx) || !Number.isFinite(dy)) {
    return [1, 1];
  }
  // Convert centimetres-per-pixel to millimetres-per-pixel.
  return [Math.abs(dx) * 10, Math.abs(dy) * 10];
}

// Convert RGBA (from createImageBitmap or our native decoder) to a 3-component
// RGB Uint8Array suitable for VTK scalar swap.
function rgbaToRgb(rgba: Uint8ClampedArray, out: Uint8Array): void {
  const pixels = rgba.length >> 2;
  for (let i = 0; i < pixels; i++) {
    const src = i * 4;
    const dst = i * 3;
    out[dst] = rgba[src];
    out[dst + 1] = rgba[src + 1];
    out[dst + 2] = rgba[src + 2];
  }
}

export default class DicomCineImage extends BaseProgressiveImage {
  public readonly header: CineHeader;

  private readonly frames: Uint8Array[];
  private readonly encapsulated: boolean;
  private readonly cache: FrameCache;
  private readonly inFlightFrames: Map<number, Promise<DecodedFrame>>;
  private readonly events: Emitter<ProgressiveImageEvents>;
  private readonly scalarBuffer: Uint8Array;

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
    const cols = header.cols;
    const rows = header.rows;
    if (!cols || !rows) {
      throw new Error('Cine DICOM has invalid Rows/Columns');
    }
    this.scalarBuffer = new Uint8Array(cols * rows * 3);
    const imageData = vtkImageData.newInstance();
    imageData.setExtent([0, cols - 1, 0, rows - 1, 0, 0]);
    // Region calibration — DICOM C.8.5.5.1: PhysicalUnits=3 means cm. We only
    // apply spacing when both axes report cm, so length measurements come out
    // in millimetres. Anything else (missing region, percent, dB, m/s, mixed
    // units) leaves spacing at 1 — the ruler then reports pixels, which is
    // the documented v1 behavior.
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

    // The cine clip has all metadata up-front, so it is "complete" once the
    // first frame is decoded. Volume views still see status='incomplete' until
    // we kick off the initial decode in startLoad().
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
    // No streaming step — the compressed bytes are already in memory. We
    // decode the first frame so the canonical compatibility image has valid
    // scalars for older consumers (thumbnail, getVtkImageData, metadata).
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
        this.applyDecodedFrame(frame.rgba);
        this.markComplete();
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
    // Clear the compressed-frame views; we don't own the underlying buffer
    // (it was sliced from the original ArrayBuffer), but null'ing the array
    // lets GC reclaim the wrapper objects.
    this.frames.length = 0;
    this.vtkImageData.value.delete();
  }

  getNumberOfFrames(): number {
    return this.header.numberOfFrames;
  }

  // Decoded-frame access for per-view render buffers. Concurrent requests
  // for the same uncached frame share a single decode via inFlightFrames.
  async getFrame(frameIndex: number): Promise<DecodedFrame> {
    if (this.disposed) {
      throw new Error('DicomCineImage is disposed');
    }
    const clamped = Math.max(
      0,
      Math.min(this.header.numberOfFrames - 1, frameIndex | 0)
    );

    const cached = this.cache.get(clamped);
    if (cached) return cached;

    const inFlight = this.inFlightFrames.get(clamped);
    if (inFlight) return inFlight;

    const decodePromise = (async () => {
      try {
        const decoded = await this.decode(clamped);
        if (this.disposed) {
          throw new Error('DicomCineImage is disposed');
        }
        this.cache.set(clamped, decoded);
        return decoded;
      } catch (err) {
        // Disposal isn't a decode failure; don't emit a user-visible error.
        if (!this.disposed) {
          this.reportError(err);
        }
        throw err;
      } finally {
        this.inFlightFrames.delete(clamped);
      }
    })();

    this.inFlightFrames.set(clamped, decodePromise);
    return decodePromise;
  }

  // Emit an error and clear the loading flag — otherwise consumers stay stuck
  // on the spinner forever after a bad first-frame decode.
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

  private applyDecodedFrame(rgba: Uint8ClampedArray): void {
    rgbaToRgb(rgba, this.scalarBuffer);
    const scalars = this.vtkImageData.value.getPointData().getScalars();
    scalars.modified();
    this.vtkImageData.value.modified();
  }

  private markComplete(): void {
    if (this.status.value !== 'complete') {
      this.events.emit('status', 'complete');
    }
    if (this.loading.value) {
      this.events.emit('loading', false);
    }
  }

  // Helper used by import routing to decide whether the file is cine-renderable.
  static isSupported(header: CineHeader): boolean {
    if (!isSupportedCineTransferSyntax(header.transferSyntaxUID)) return false;
    if (isNativeTransferSyntax(header.transferSyntaxUID)) {
      // Native pixel data: only support 8-bit RGB or grayscale for v1.
      if (header.bitsAllocated !== 8) return false;
      if (header.samplesPerPixel !== 1 && header.samplesPerPixel !== 3) {
        return false;
      }
    }
    return true;
  }
}
