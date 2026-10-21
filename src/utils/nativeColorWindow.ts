const nativeColorWidths: Record<string, number> = {
  Uint8Array: 255,
  Uint8ClampedArray: 255,
  Uint16Array: 65535,
  Uint32Array: 4294967295,
  Int8Array: 127,
  Int16Array: 32767,
  Int32Array: 2147483647,
  Float32Array: 1,
  Float64Array: 1,
};

export function nativeColorWindow(dataType: string | undefined) {
  // Native channels use a zero-based integer range or normalized floats.
  const width = nativeColorWidths[dataType ?? 'Uint8Array'] ?? 255;
  return { width, level: width / 2 };
}
