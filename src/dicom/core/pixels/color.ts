/** Interleaved full range YCbCr (ITU-R BT.601) as interleaved RGB. */
export function ybrFullAsRgb(ybr: Uint8Array) {
  const rgb = new Uint8ClampedArray(ybr.length);
  for (let at = 0; at < ybr.length; at += 3) {
    const y = ybr[at];
    const cb = ybr[at + 1] - 128;
    const cr = ybr[at + 2] - 128;
    rgb[at] = y + 1.402 * cr;
    rgb[at + 1] = y - 0.344136 * cb - 0.714136 * cr;
    rgb[at + 2] = y + 1.772 * cb;
  }
  return new Uint8Array(rgb.buffer);
}

/**
 * Uncompressed YBR_FULL_422 as interleaved YCbCr: each pair of pixels in a
 * row is stored as Y, Y, Cb, Cr and shares the one chroma sample.
 */
export function ybr422AsYbrFull(stored: Uint8Array, pixels: number) {
  const ybr = new Uint8Array(pixels * 3);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const pair = (pixel >> 1) * 4;
    ybr[pixel * 3] = stored[pair + (pixel & 1)];
    ybr[pixel * 3 + 1] = stored[pair + 2];
    ybr[pixel * 3 + 2] = stored[pair + 3];
  }
  return ybr;
}

/** Color planes stored one after another as interleaved samples. */
export function planesAsInterleaved(planes: Uint8Array, pixels: number) {
  const components = planes.length / pixels;
  const interleaved = new Uint8Array(planes.length);
  for (let component = 0; component < components; component += 1)
    for (let pixel = 0; pixel < pixels; pixel += 1)
      interleaved[pixel * components + component] =
        planes[component * pixels + pixel];
  return interleaved;
}
