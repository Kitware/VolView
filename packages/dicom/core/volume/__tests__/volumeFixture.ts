import {
  sliceDataset,
  type SliceOptions,
} from '../../collections/__tests__/sliceFixture';
import { instanceFor } from '@/tests/dicomDataset';
import { plannedUpdate } from '@/tests/dicomVolumeFixtures';
import type { Instance } from '../../instance/readInstance';
import type { WholeInstanceDecode } from '../../pixels/pixelDecoder';
import { fromBlob } from '../../source/byteSource';
import {
  allocateVolume,
  type AllocateVolumeOptions,
  type Volume,
} from '../allocateVolume';

export const PIXELS_PER_SLICE = 16;

const PIXEL_TAGS = {
  '0028|0101': '16',
  '0028|0103': '0',
  '0028|0030': '0.5\\0.5',
};

/** A 4x4 slice at z = value whose source bytes spell its pixel value. */
export const pixelSlice = (value: number, options: SliceOptions = {}) =>
  instanceFor(
    sliceDataset({
      sop: `pixel-${value}`,
      z: value,
      ...options,
      tags: { ...PIXEL_TAGS, ...options.tags },
    }),
    fromBlob(new Blob([String(value)]))
  );

export const allocated = (
  members: Instance[],
  previous?: Volume,
  options: AllocateVolumeOptions = {}
) => allocateVolume(plannedUpdate(members), options, previous);

/** The slice a source written by `pixelSlice` decodes to. */
export const slicePixels = (bytes: Uint8Array) => {
  const value = Number(new TextDecoder().decode(bytes));
  return {
    value,
    size: [4, 4, 1] as const,
    data: new Uint16Array(PIXELS_PER_SLICE).fill(value),
    components: 1,
  };
};

/** Decodes a source written by `pixelSlice`, recording each value it decodes. */
export const valueDecoder =
  (decoded: number[] = []): WholeInstanceDecode =>
  async ({ bytes }) => {
    const { value, ...pixels } = slicePixels(bytes);
    decoded.push(value);
    return pixels;
  };

/** The first sample of every slice, or null where none is loaded yet. */
export const sliceValues = (volume: Volume) =>
  Array.from(volume.loaded, (isLoaded, slice) =>
    isLoaded ? volume.data[slice * PIXELS_PER_SLICE] : null
  );
