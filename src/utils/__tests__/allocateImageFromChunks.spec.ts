import { getTypedArrayForDataRange } from '@/src/utils/allocateImageFromChunks';
import { describe, it, expect } from 'vitest';

describe('getTypedArrayForDataRange', () => {
  it('should handle edge cases', () => {
    expect(getTypedArrayForDataRange(-(2 ** 7), 2 ** 7 - 1)).toBe(Int8Array);
    expect(getTypedArrayForDataRange(-(2 ** 15), 2 ** 15 - 1)).toBe(Int16Array);
    expect(getTypedArrayForDataRange(-(2 ** 31), 2 ** 31 - 1)).toBe(Int32Array);
    expect(getTypedArrayForDataRange(0, 2 ** 8 - 1)).toBe(Uint8Array);
    expect(getTypedArrayForDataRange(0, 2 ** 16 - 1)).toBe(Uint16Array);
    expect(getTypedArrayForDataRange(0, 2 ** 32 - 1)).toBe(Uint32Array);
  });
});
