import * as Comlink from 'comlink';
import type { DecodedFrame } from './frameCache';

async function decodeJpeg(
  bytes: Uint8Array,
  expectedWidth: number,
  expectedHeight: number
): Promise<DecodedFrame> {
  const blob = new Blob([bytes as BlobPart], { type: 'image/jpeg' });
  const bitmap = await createImageBitmap(blob);
  try {
    if (
      (expectedWidth && bitmap.width !== expectedWidth) ||
      (expectedHeight && bitmap.height !== expectedHeight)
    ) {
      // Per-view RGB buffer is sized from DICOM Rows/Columns; a mismatched JPEG
      // can never be copied into it, so fail loudly instead of rendering black.
      throw new Error(
        `JPEG frame size ${bitmap.width}x${bitmap.height} does not match DICOM-declared ${expectedWidth}x${expectedHeight}`
      );
    }
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');
    ctx.drawImage(bitmap, 0, 0);
    const { data: rgba } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    // Pack RGBA→RGB in-worker so the main thread only does a single
    // typed-array copy when publishing the frame.
    const pixels = bitmap.width * bitmap.height;
    const rgb = new Uint8Array(pixels * 3);
    for (let i = 0; i < pixels; i++) {
      const s = i * 4;
      const d = i * 3;
      rgb[d] = rgba[s];
      rgb[d + 1] = rgba[s + 1];
      rgb[d + 2] = rgba[s + 2];
    }
    const result: DecodedFrame = {
      width: bitmap.width,
      height: bitmap.height,
      rgb,
    };
    return Comlink.transfer(result, [rgb.buffer]);
  } finally {
    bitmap.close();
  }
}

export interface JpegDecoderWorker {
  decodeJpeg: typeof decodeJpeg;
}

Comlink.expose({ decodeJpeg });
