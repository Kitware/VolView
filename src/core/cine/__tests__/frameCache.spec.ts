import { describe, expect, it } from 'vitest';
import {
  decodeNativeFrame,
  FrameCache,
  type DecodedFrame,
} from '../frameCache';

const MiB = 1024 * 1024;

function frame(byteLength: number): DecodedFrame {
  return {
    width: 1,
    height: 1,
    rgba: { byteLength } as Uint8ClampedArray,
  };
}

describe('FrameCache', () => {
  it('defaults to a 64 MiB budget', () => {
    const cache = new FrameCache();

    cache.set(0, frame(32 * MiB));
    cache.set(1, frame(32 * MiB));

    expect(cache.has(0)).toBe(true);
    expect(cache.has(1)).toBe(true);
    expect(cache.getBytesInUse()).toBe(64 * MiB);

    cache.set(2, frame(1));

    expect(cache.has(0)).toBe(false);
    expect(cache.has(1)).toBe(true);
    expect(cache.has(2)).toBe(true);
    expect(cache.getBytesInUse()).toBe(32 * MiB + 1);
  });

  it('refreshes entries on get before LRU eviction', () => {
    const cache = new FrameCache(10);

    cache.set(0, frame(4));
    cache.set(1, frame(4));
    expect(cache.get(0)).not.toBeNull();
    cache.set(2, frame(4));

    expect(cache.has(0)).toBe(true);
    expect(cache.has(1)).toBe(false);
    expect(cache.has(2)).toBe(true);
  });
});

describe('decodeNativeFrame', () => {
  it('decodes pixel-interleaved native RGB frames', () => {
    const decoded = decodeNativeFrame(Uint8Array.from([1, 2, 3, 4, 5, 6]), {
      width: 2,
      height: 1,
      samplesPerPixel: 3,
      photometric: 'RGB',
      planarConfiguration: 0,
    });

    expect(Array.from(decoded.rgba)).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
  });

  it('decodes plane-interleaved native RGB frames', () => {
    const decoded = decodeNativeFrame(Uint8Array.from([1, 4, 2, 5, 3, 6]), {
      width: 2,
      height: 1,
      samplesPerPixel: 3,
      photometric: 'RGB',
      planarConfiguration: 1,
    });

    expect(Array.from(decoded.rgba)).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
  });
});
