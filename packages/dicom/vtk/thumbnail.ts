/** An 8 bit greyscale slice, small enough to encode as a thumbnail. */
export type ThumbnailSlice = {
  width: number;
  height: number;
  data: Uint8Array;
};

export type SliceToThumbnailInput = {
  data: ArrayLike<number>;
  width: number;
  height: number;
  // Samples per pixel; only the first component is read.
  components?: number;
  // The window mapped onto 0..255.
  range: readonly [number, number];
  maxSize?: number;
};

export const THUMBNAIL_MAX_SIZE = 256;

const BYTE_MAX = 255;

/** Downsamples one slice and casts it to 8 bit greyscale. */
export function sliceToThumbnail({
  data,
  width,
  height,
  components = 1,
  range,
  maxSize = THUMBNAIL_MAX_SIZE,
}: SliceToThumbnailInput): ThumbnailSlice {
  const [low, high] = range;
  const span = high - low;

  // One integer stride on both axes, so the aspect ratio survives.
  const stride = Math.max(1, Math.ceil(Math.max(width, height) / maxSize));
  const thumbWidth = Math.ceil(width / stride);
  const thumbHeight = Math.ceil(height / stride);

  const toByte = (sample: number) => {
    if (!Number.isFinite(sample) || span <= 0) return 0;
    const scaled = Math.round(((sample - low) / span) * BYTE_MAX);
    return Math.min(BYTE_MAX, Math.max(0, scaled));
  };

  const thumbData = Uint8Array.from(
    { length: thumbWidth * thumbHeight },
    (_, index) => {
      const column = (index % thumbWidth) * stride;
      const row = Math.floor(index / thumbWidth) * stride;
      return toByte(data[(row * width + column) * components]);
    }
  );

  return { width: thumbWidth, height: thumbHeight, data: thumbData };
}

/** Encodes a thumbnail slice as a PNG data URI. */
export function encodeThumbnailToUri(slice: ThumbnailSlice) {
  const { width, height, data } = slice;
  const image = new ImageData(width, height);
  const pixels = new Uint32Array(image.data.buffer);
  // ABGR order.
  data.forEach((byte, index) => {
    pixels[index] = (BYTE_MAX << 24) | (byte << 16) | (byte << 8) | byte;
  });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return '';

  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}
