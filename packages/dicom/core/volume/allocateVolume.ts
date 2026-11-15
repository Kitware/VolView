import type { Instance } from '../instance/readInstance';
import type { ImageCollectionUpdate } from '../collections/instanceRegistry';
import type { SpatialMetadata } from '../metadata/spatialMetadata';
import type { VolumeBuffer } from './pixelFormat';
import { nativeFramesOverrun } from '../pixels/frameIndex';
import { planVolumeAllocation } from './volumeLayout';

type Triple = [number, number, number];
type Vector3 = Readonly<Triple>;

/**
 * One buffer plus the geometry that places it. Everything is immutable except
 * `data` and `loaded`, which only `loadVolume` writes.
 */
export type Volume = Readonly<{
  /** Planned order; in a multi-file volume member i fills slice i. */
  members: readonly Instance[];
  /** Columns, rows, slices. */
  dimensions: Vector3;
  components: number;
  origin: Vector3;
  /** Row-major 3x3: row direction, column direction, slice direction. */
  direction: readonly number[];
  spacing: Vector3;
  spatialMetadata: SpatialMetadata;
  /** Allocation warnings as [title, details]. */
  warnings: ReadonlyArray<readonly [string, string]>;
  data: VolumeBuffer;
  /** 1 where a slice holds decoded pixels, indexed by slice. */
  loaded: Uint8Array;
}>;

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** The slices one member fills: one per file, or every frame of a lone instance. */
export const memberSlices = (volume: Volume, member: number) =>
  volume.members.length > 1
    ? [member]
    : Array.from({ length: volume.dimensions[2] }, (_, slice) => slice);

export const memberLoaded = (volume: Volume, member: number) =>
  memberSlices(volume, member).every((slice) => volume.loaded[slice] === 1);

export const sliceLength = (volume: Volume) =>
  volume.dimensions[0] * volume.dimensions[1] * volume.components;

const samePixelShape = (volume: Volume, previous: Volume) =>
  volume.data.constructor === previous.data.constructor &&
  volume.dimensions[0] === previous.dimensions[0] &&
  volume.dimensions[1] === previous.dimensions[1] &&
  volume.components === previous.components;

function copyMember(
  volume: Volume,
  member: number,
  previous: Volume,
  from: number
) {
  const source = memberSlices(previous, from);
  const target = memberSlices(volume, member);
  if (source.length !== target.length || !memberLoaded(previous, from)) return;
  const length = sliceLength(volume);
  source.forEach((slice, index) => {
    const start = slice * length;
    volume.data.set(
      previous.data.subarray(start, start + length),
      target[index] * length
    );
    volume.loaded[target[index]] = 1;
  });
}

// Decoded slices follow their instance, whose slot may have moved.
function copyDecoded(volume: Volume, previous: Volume) {
  if (!samePixelShape(volume, previous)) return;
  const previousIndex = new Map(
    previous.members.map((member, index) => [member, index])
  );
  volume.members.forEach((member, index) => {
    const from = previousIndex.get(member);
    if (from !== undefined) copyMember(volume, index, previous, from);
  });
}

/**
 * Allocates the volume a planned image collection fills. With `previous`,
 * slices already decoded there are copied across, so growth never decodes
 * again.
 */
export function allocateVolume(
  update: Pick<ImageCollectionUpdate, 'kind' | 'collection' | 'members'>,
  previous?: Volume
) {
  const { collection, members } = update;
  // A lone instance's frames are the volume's slices, so they must exist.
  const overrun = members.length === 1 && nativeFramesOverrun(members[0]);
  if (overrun)
    throw new Error(
      `The instance declares more frames than its Pixel Data holds: ${overrun}`
    );
  const { layout, warnings } = planVolumeAllocation(
    members,
    collection.orientation,
    collection.reconstruction
  );
  const { columns, rows, slices, samplesPerPixel } = layout;
  const volume: Volume = Object.freeze({
    members: Object.freeze([...members]),
    dimensions: [columns, rows, slices] as const,
    components: samplesPerPixel,
    origin: (layout.origin ?? [0, 0, 0]) as Triple,
    direction: layout.direction ?? IDENTITY,
    spacing: layout.spatialMetadata.axes.map((axis) => axis.value) as Triple,
    spatialMetadata: layout.spatialMetadata,
    warnings,
    data: new layout.bufferType(columns * rows * slices * samplesPerPixel),
    loaded: new Uint8Array(slices),
  });
  if (previous) copyDecoded(volume, previous);
  return volume;
}

/** Per-component [min, max] over the loaded slices; empty when none are. */
export function loadedRange(volume: Volume) {
  const length = sliceLength(volume);
  const ranges: Array<[number, number]> = [];
  volume.loaded.forEach((isLoaded, slice) => {
    if (!isLoaded) return;
    const samples = volume.data.subarray(slice * length, (slice + 1) * length);
    componentRanges(samples, volume.components).forEach(([min, max], index) => {
      const current = ranges[index] ?? [min, max];
      ranges[index] = [Math.min(current[0], min), Math.max(current[1], max)];
    });
  });
  return ranges;
}

/** Per-component [min, max] of interleaved samples, ignoring NaN. */
export function componentRanges(
  samples: ArrayLike<number>,
  components: number
) {
  return Array.from({ length: components }, (_, component) => {
    let min = Infinity;
    let max = -Infinity;
    for (let index = component; index < samples.length; index += components) {
      const value = samples[index];
      if (value < min) min = value;
      if (value > max) max = value;
    }
    return [min, max] as [number, number];
  });
}
