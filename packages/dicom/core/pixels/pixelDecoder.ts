import type { Instance } from '../instance/readInstance';
import type { ByteRange } from '../source/byteSource';
import { getDatasetTag } from '../metadata/datasetAccess';
import { numberOr, type Awaitable } from '../utils';
import type { VolumeBufferConstructor } from '../volume/pixelFormat';

/** Samples for `size[2]` consecutive frames, interleaved by component. */
export type DecodedPixels = Readonly<{
  data: ArrayLike<number>;
  /** Columns, rows, frames. */
  size: readonly [number, number, number];
  components: number;
  /**
   * Each component's [min, max] before conversion into `data`'s element
   * type; computed from `data` when absent.
   */
  range?: ReadonlyArray<readonly [number, number]>;
}>;

/** One read and one decode. A whole instance is a unit covering every frame. */
export type DecodeUnit = Readonly<{
  firstFrame: number;
  frames: number;
  /** Bytes of the instance's source to read; null for all of them. */
  range: ByteRange | null;
  /** The returned pixels belong to the caller; `bytes` may be transferred away. */
  decode: (bytes: Uint8Array, signal: AbortSignal) => Awaitable<DecodedPixels>;
}>;

export type PixelDecoder = Readonly<{
  name: string;
  /**
   * From the header alone: the units this decoder loads `instance` in, or why
   * it declines. `target` is the element type the samples are written into.
   */
  plan: (
    instance: Instance,
    target: VolumeBufferConstructor
  ) => DecodeUnit[] | Readonly<{ declined: string }>;
}>;

export type WholeInstanceDecode = (
  request: Readonly<{ instance: Instance; bytes: Uint8Array }>,
  signal: AbortSignal
) => Awaitable<DecodedPixels>;

export const frameCount = (instance: Instance) =>
  numberOr(getDatasetTag(instance.dataset, '00280008'), 1);

/** A decoder that reads and decodes every instance whole. */
export const wholeInstanceDecoder = (
  name: string,
  decode: WholeInstanceDecode
): PixelDecoder => ({
  name,
  plan: (instance) => [
    {
      firstFrame: 0,
      frames: frameCount(instance),
      range: null,
      decode: (bytes, signal) => decode({ instance, bytes }, signal),
    },
  ],
});
