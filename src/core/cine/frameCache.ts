// Decoded-frame cache for cine playback.
//
// Holds CPU-visible RGBA bytes (not ImageBitmaps) because VTK's scalar buffer
// needs to copy them in. Bounded by a byte budget; LRU eviction. Per-image
// instance — disposed alongside the DicomCineImage that owns it.

export type DecodedFrame = {
  width: number;
  height: number;
  // RGBA, 8-bit per channel, row-major (matches OffscreenCanvas getImageData).
  rgba: Uint8ClampedArray;
};

const DEFAULT_BUDGET_BYTES = 256 * 1024 * 1024;

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
      this.bytesInUse -= existing.rgba.byteLength;
      this.entries.delete(frameIndex);
    }
    this.entries.set(frameIndex, frame);
    this.bytesInUse += frame.rgba.byteLength;
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
      this.bytesInUse -= entry.rgba.byteLength;
      this.entries.delete(key);
    }
  }
}

// =================================================================
// Decoders
// =================================================================

// Decode a single JPEG-Baseline compressed frame to RGBA using the browser's
// native JPEG decoder. Returns the decoded pixel bytes that can be copied
// directly into a VTK scalar buffer.
export async function decodeJpegFrame(
  bytes: Uint8Array,
  expectedWidth: number,
  expectedHeight: number
): Promise<DecodedFrame> {
  // The Uint8Array is a view into the original DICOM ArrayBuffer; the cast
  // satisfies the lib.dom typing of BlobPart (which excludes SharedArrayBuffer-
  // backed views) without forcing a buffer copy.
  const blob = new Blob([bytes as BlobPart], { type: 'image/jpeg' });
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    if (
      (expectedWidth && bitmap.width !== expectedWidth) ||
      (expectedHeight && bitmap.height !== expectedHeight)
    ) {
      // Mismatch is unusual for valid DICOM US clips. Keep the data but flag
      // it in the console — the caller will still copy whatever it returns.
      console.warn(
        `JPEG frame size ${bitmap.width}x${bitmap.height} does not match DICOM-declared ${expectedWidth}x${expectedHeight}`
      );
    }
    return {
      width: bitmap.width,
      height: bitmap.height,
      rgba: imageData.data,
    };
  } finally {
    bitmap.close();
  }
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

// Convert a raw uncompressed frame to RGBA. Supports the two photometric
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
  const out = new Uint8ClampedArray(pixelCount * 4);

  if (samplesPerPixel === 1) {
    // Grayscale — replicate luminance to R, G, B; alpha = 255.
    for (let i = 0; i < pixelCount; i++) {
      const v = bytes[i] ?? 0;
      const j = i * 4;
      out[j] = v;
      out[j + 1] = v;
      out[j + 2] = v;
      out[j + 3] = 255;
    }
  } else if (
    samplesPerPixel === 3 &&
    (photometric === 'RGB' || photometric === 'PALETTE COLOR')
  ) {
    if (planarConfiguration === 1) {
      // RRRR...GGGG...BBBB...
      const plane = pixelCount;
      for (let i = 0; i < pixelCount; i++) {
        const j = i * 4;
        out[j] = bytes[i] ?? 0;
        out[j + 1] = bytes[plane + i] ?? 0;
        out[j + 2] = bytes[2 * plane + i] ?? 0;
        out[j + 3] = 255;
      }
    } else {
      for (let i = 0; i < pixelCount; i++) {
        const k = i * 3;
        const j = i * 4;
        out[j] = bytes[k] ?? 0;
        out[j + 1] = bytes[k + 1] ?? 0;
        out[j + 2] = bytes[k + 2] ?? 0;
        out[j + 3] = 255;
      }
    }
  } else {
    throw new Error(
      `Unsupported native frame format: ${photometric} samplesPerPixel=${samplesPerPixel}`
    );
  }

  return { width, height, rgba: out };
}
