import {
  emptyRegistry,
  registerInstances,
} from '../../collections/instanceRegistry';
import {
  sliceDataset,
  type SliceOptions,
} from '../../collections/__tests__/sliceFixture';
import { instanceFor } from '../../instance/__tests__/instanceFixture';
import type { Instance } from '../../instance/readInstance';
import type { PixelDecoder } from '../../runtime/createDicomRuntime';
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

export const plannedUpdate = (members: Instance[]) =>
  registerInstances(emptyRegistry, members).updates[0];

export function allocated(
  members: Instance[],
  previous?: Volume,
  options: AllocateVolumeOptions = {}
) {
  const result = allocateVolume(plannedUpdate(members), options, previous);
  if (result.kind !== 'volume') throw new Error(`Allocated ${result.kind}`);
  return result.volume;
}

/** Decodes a source written by `pixelSlice`, recording each value it decodes. */
export const valueDecoder =
  (decoded: number[] = []): PixelDecoder =>
  async ({ bytes }) => {
    const value = Number(new TextDecoder().decode(bytes));
    decoded.push(value);
    return {
      size: [4, 4, 1],
      data: new Uint16Array(PIXELS_PER_SLICE).fill(value),
      imageType: { components: 1 },
    };
  };

/** The first sample of every slice, or null where none is loaded yet. */
export const sliceValues = (volume: Volume) =>
  Array.from(volume.loaded, (isLoaded, slice) =>
    isLoaded ? volume.data[slice * PIXELS_PER_SLICE] : null
  );
