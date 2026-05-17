// Decoded-frame cache for cine playback.
//
// Holds CPU-visible RGB bytes packed for direct copy into VTK's 3-component
// scalar buffer. Bounded by a byte budget; LRU eviction. Per-image instance —
// disposed alongside the DicomCineImage that owns it.

import { decodeJpegInWorker } from './jpegDecodePool';

export type DecodedFrame = {
  width: number;
  height: number;
  // RGB, 8-bit per channel, row-major. Packed in the decoder (worker for JPEG)
  // so the main thread can publish frames with a single buffer copy.
  rgb: Uint8Array;
};

// Returns false when the buffers disagree on pixel count, so callers can skip
// the publish step instead of rendering a partial frame.
export function copyDecodedFrameToRgb(
  frame: DecodedFrame,
  out: Uint8Array
): boolean {
  if (frame.rgb.length !== out.length) return false;
  out.set(frame.rgb);
  return true;
}

const DEFAULT_BUDGET_BYTES = 64 * 1024 * 1024;

export class FrameCache {
  private readonly budgetBytes: number;
  private bytesInUse: number;
  // Insertion-ordered Map gives O(1) LRU behavior.
  private readonly entries: Map<number, DecodedFrame>;

  constructor(budgetBytes: number = DEFAULT_BUDGET_BYTES) {
    this.budgetBytes = budgetBytes;
    this.bytesInUse = 0;
    this.entries = new Map();
  }

  get(frameIndex: number): DecodedFrame | null {
    const entry = this.entries.get(frameIndex);
    if (!entry) return null;
    // Move to "most recent" by re-inserting.
    this.entries.delete(frameIndex);
    this.entries.set(frameIndex, entry);
    return entry;
  }

  set(frameIndex: number, frame: DecodedFrame): void {
    const existing = this.entries.get(frameIndex);
    if (existing) {
      this.bytesInUse -= existing.rgb.byteLength;
      this.entries.delete(frameIndex);
    }
    this.entries.set(frameIndex, frame);
    this.bytesInUse += frame.rgb.byteLength;
    this.evictUntilUnderBudget();
  }

  has(frameIndex: number): boolean {
    return this.entries.has(frameIndex);
  }

  clear(): void {
    this.entries.clear();
    this.bytesInUse = 0;
  }

  size(): number {
    return this.entries.size;
  }

  getBytesInUse(): number {
    return this.bytesInUse;
  }

  private evictUntilUnderBudget(): void {
    if (this.bytesInUse <= this.budgetBytes) return;
    // Map iteration order is insertion order; the oldest entry is the first.
    for (const key of this.entries.keys()) {
      if (this.bytesInUse <= this.budgetBytes) break;
      const entry = this.entries.get(key)!;
      this.bytesInUse -= entry.rgb.byteLength;
      this.entries.delete(key);
    }
  }
}

export function decodeJpegFrame(
  bytes: Uint8Array,
  expectedWidth: number,
  expectedHeight: number
): Promise<DecodedFrame> {
  return decodeJpegInWorker(bytes, expectedWidth, expectedHeight);
}

type NativeFrameLayout = {
  width: number;
  height: number;
  samplesPerPixel: number;
  photometric: string;
  // DICOM PlanarConfiguration (0028,0006): 0 = pixel-interleaved (RGBRGB...),
  // 1 = plane-interleaved (RRR...GGG...BBB...).
  planarConfiguration: number;
};

// Convert a raw uncompressed frame to packed RGB. Supports the two photometric
// interpretations our sample corpus shows in the native PixelData path:
// - 'RGB' with samplesPerPixel=3 (interleaved RGB)
// - 'MONOCHROME2' with samplesPerPixel=1 (grayscale, replicated to RGB)
export function decodeNativeFrame(
  bytes: Uint8Array,
  layout: NativeFrameLayout
): DecodedFrame {
  const { width, height, samplesPerPixel, photometric, planarConfiguration } =
    layout;
  const pixelCount = width * height;
  const out = new Uint8Array(pixelCount * 3);

  if (samplesPerPixel === 1) {
    // Grayscale — replicate luminance to R, G, B.
    for (let i = 0; i < pixelCount; i++) {
      const v = bytes[i] ?? 0;
      const j = i * 3;
      out[j] = v;
      out[j + 1] = v;
      out[j + 2] = v;
    }
  } else if (
    samplesPerPixel === 3 &&
    (photometric === 'RGB' || photometric === 'PALETTE COLOR')
  ) {
    if (planarConfiguration === 1) {
      // RRRR...GGGG...BBBB...
      const plane = pixelCount;
      for (let i = 0; i < pixelCount; i++) {
        const j = i * 3;
        out[j] = bytes[i] ?? 0;
        out[j + 1] = bytes[plane + i] ?? 0;
        out[j + 2] = bytes[2 * plane + i] ?? 0;
      }
    } else {
      for (let i = 0; i < pixelCount; i++) {
        const k = i * 3;
        out[k] = bytes[k] ?? 0;
        out[k + 1] = bytes[k + 1] ?? 0;
        out[k + 2] = bytes[k + 2] ?? 0;
      }
    }
  } else {
    throw new Error(
      `Unsupported native frame format: ${photometric} samplesPerPixel=${samplesPerPixel}`
    );
  }

  return { width, height, rgb: out };
}
