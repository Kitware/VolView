import type { DicomRuntime } from '../runtime/createDicomRuntime';
import { getDatasetTag } from '../metadata/datasetAccess';
import { Tags } from '../metadata/dicomTags';
import { abortError, linkedController } from '../utils';
import { readBytes } from '../source/byteSource';
import { planDecode, type DecoderTable } from '../pixels/decoderTable';
import type { DecodedPixels, DecodeUnit } from '../pixels/pixelDecoder';
import { getPixelFormat, type VolumeBufferConstructor } from './pixelFormat';
import {
  componentRanges,
  memberLoaded,
  memberSlices,
  sliceLength,
  type Volume,
} from './allocateVolume';
import { assertSamplesRepresentable, assertUnitFits } from './pixelValidation';
import { pickNextSlot } from './slotOrder';

/** [xMin, xMax, yMin, yMax, zMin, zMax], inclusive, as vtk.js extents are. */
export type Extent = [number, number, number, number, number, number];

/**
 * A decoded unit, or a failed one. A failure's extent spans the slices it
 * leaves unloaded; slices inside it that loaded earlier stay loaded.
 */
export type VolumeUpdate =
  | { slot: number; extent: Extent; range: Array<[number, number]> }
  | { slot: number; extent: Extent; error: Error };

export type LoadVolumeOptions = {
  runtime: Pick<
    DicomRuntime,
    'decoders' | 'decodeConcurrency' | 'readConcurrency' | 'signal'
  >;
  signal: AbortSignal;
  /** Read before every read and decode; defaults to the middle slice. */
  focus?: () => number;
};

/** A planned unit placed in the volume; `slot` is its first slice. */
type Unit = DecodeUnit &
  Readonly<{ member: number; slices: readonly number[]; slot: number }>;

const ensureError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

// Reduced rather than spread: a lone instance can have more slices than a call takes arguments.
const lowest = (values: readonly number[]) =>
  values.reduce((low, value) => Math.min(low, value), Infinity);
const highest = (values: readonly number[]) =>
  values.reduce((high, value) => Math.max(high, value), -Infinity);

const sliceExtent = (volume: Volume, slices: readonly number[]): Extent => [
  0,
  volume.dimensions[0] - 1,
  0,
  volume.dimensions[1] - 1,
  lowest(slices),
  highest(slices),
];

const failure = (
  volume: Volume,
  slices: readonly number[],
  error: unknown
): VolumeUpdate => ({
  slot: lowest(slices),
  extent: sliceExtent(volume, slices),
  error: ensureError(error),
});

const memberName = (volume: Volume, member: number) => {
  const sop = getDatasetTag(
    volume.members[member].dataset,
    Tags.SOPInstanceUID
  );
  return `File ${sop ?? 'without SOP Instance UID'} (member ${member})`;
};

const unitName = (volume: Volume, unit: Unit) => {
  const name = memberName(volume, unit.member);
  return unit.frames === memberSlices(volume, unit.member).length
    ? name
    : `${name}, frame ${unit.firstFrame}`;
};

/** A Float32 volume holds rounded values, so the range it reports is rounded too. */
const storedRange = (
  volume: Volume,
  range: ReadonlyArray<readonly [number, number]>
) => {
  const stored = volume.data instanceof Float32Array ? Math.fround : Number;
  return range.map(([min, max]): [number, number] => [
    stored(min),
    stored(max),
  ]);
};

/** A read or decode failure naming what it lost, with the thrown value as `cause`. */
const unitFailure = (
  where: string,
  stage: 'read' | 'decoded',
  cause: unknown
) => {
  const culprit = stage === 'read' ? 'source' : 'decoder';
  const detail =
    (cause instanceof Error && cause.message) ||
    `the ${culprit} failed without a message`;
  return new Error(`${where} could not be ${stage}: ${detail}`, { cause });
};

/** Validates decoded pixels and writes them into the buffer. */
function write(volume: Volume, unit: Unit, pixels: DecodedPixels) {
  const where = unitName(volume, unit);
  const { data, size, components } = pixels;
  assertUnitFits(
    { size, components, samples: data.length },
    {
      dims: volume.dimensions,
      components: volume.components,
      frames: unit.frames,
      multiFile: volume.members.length > 1,
    },
    where
  );
  const range = pixels.range ?? componentRanges(data, volume.components);
  const { dataset } = volume.members[unit.member];
  assertSamplesRepresentable(
    data,
    {
      min: Math.min(...range.map(([min]) => min)),
      max: Math.max(...range.map(([, max]) => max)),
    },
    volume.data,
    {
      where,
      rescales: () =>
        Array.from({ length: unit.frames }, (_, index) =>
          getPixelFormat(dataset, unit.firstFrame + index)
        ),
    }
  );
  volume.data.set(data, sliceLength(volume) * unit.slot);
  return {
    slot: unit.slot,
    extent: sliceExtent(volume, unit.slices),
    range: storedRange(volume, range),
  };
}

function planMember(volume: Volume, member: number, decoders: DecoderTable) {
  const instance = volume.members[member];
  const slices = memberSlices(volume, member);
  const target = volume.data.constructor as VolumeBufferConstructor;
  const planned = planDecode(decoders, instance, target);
  if ('error' in planned)
    throw new Error(
      `${memberName(volume, member)} cannot be decoded: ${planned.error.message}`,
      { cause: planned.error }
    );
  return planned.units.map((unit): Unit => {
    const covered = slices.slice(
      unit.firstFrame,
      unit.firstFrame + unit.frames
    );
    return { ...unit, member, slices: covered, slot: covered[0] };
  });
}

/** Units still to load, and failures known from headers alone. */
function planUnits(volume: Volume, decoders: DecoderTable) {
  const units: Unit[] = [];
  const failures: VolumeUpdate[] = [];
  volume.members.forEach((_, member) => {
    if (memberLoaded(volume, member)) return;
    try {
      units.push(
        ...planMember(volume, member, decoders).filter((unit) =>
          unit.slices.some((slice) => !volume.loaded[slice])
        )
      );
    } catch (error) {
      failures.push(failure(volume, memberSlices(volume, member), error));
    }
  });
  return { units, failures };
}

// A decoded unit's extent spans exactly the slices it wrote.
const markLoaded = (volume: Volume, update: VolumeUpdate) => {
  if ('range' in update)
    volume.loaded.fill(1, update.extent[4], update.extent[5] + 1);
};

/** The middle slice, the default focus. */
export const middleSlot = (volume: Volume) =>
  Math.floor(volume.dimensions[2] / 2);

type Loader = {
  volume: Volume;
  runtime: LoadVolumeOptions['runtime'];
  stopped: AbortSignal;
  focus: () => number;
};

/**
 * Starts reads and decodes whenever one settles: decodes first, up to the
 * decode concurrency, then reads while fewer than the read concurrency are
 * being read or wait to decode. A decoded unit is written at once, so decoding
 * never waits for the consumer.
 */
function createLoader({ volume, runtime, stopped, focus }: Loader) {
  const { units, failures } = planUnits(volume, runtime.decoders);
  const waiting = new Map(units.map((unit) => [unit.slot, unit]));
  const ready = new Map<number, { unit: Unit; bytes: Uint8Array }>();
  /** Members whose source has not yet shown it honors ranges. */
  const probing = new Set<number>();
  const updates = [...failures];
  let reading = 0;
  let decoding = 0;
  let wake: (() => void) | undefined;

  const notify = () => {
    wake?.();
    wake = undefined;
  };
  const changed = () =>
    new Promise<void>((resolve) => {
      wake = resolve;
    });
  stopped.addEventListener('abort', notify, { once: true });

  const settle = (update: VolumeUpdate) => {
    if (!stopped.aborted) updates.push(update);
    notify();
  };
  const failed = (lost: Unit[], error: unknown) =>
    failure(
      volume,
      lost.flatMap((unit) => unit.slices),
      error
    );
  const next = (slots: Iterable<number>) => pickNextSlot(slots, focus());
  const sourceOf = (unit: Unit) => volume.members[unit.member].source;
  const rangeSupport = (unit: Unit) =>
    sourceOf(unit).rangeSupport?.() ?? 'honored';

  // A server that ignores Range would resend the file for every unit, so the
  // remaining ranged units of that member come from one read.
  const batchOf = (unit: Unit) =>
    unit.range?.end !== undefined && rangeSupport(unit) === 'ignored'
      ? [...waiting.values()].filter(
          (other) =>
            other.member === unit.member && other.range?.end !== undefined
        )
      : [unit];

  const readUnits = async (batch: Unit[]) => {
    const [first] = batch;
    if (batch.length === 1)
      return [
        await readBytes(sourceOf(first), stopped, first.range ?? undefined),
      ];
    const start = lowest(batch.map((unit) => unit.range!.start));
    const end = highest(batch.map((unit) => unit.range!.end!));
    const bytes = await readBytes(sourceOf(first), stopped, { start, end });
    return batch.map(({ range }) =>
      bytes.subarray(range!.start - start, range!.end! - start)
    );
  };

  const startRead = (unit: Unit) => {
    const batch = batchOf(unit);
    batch.forEach((each) => waiting.delete(each.slot));
    const probe =
      unit.range !== null &&
      rangeSupport(unit) === 'unknown' &&
      [...waiting.values()].some((other) => other.member === unit.member);
    if (probe) probing.add(unit.member);
    reading += 1;
    readUnits(batch)
      .then(
        (bytes) =>
          batch.forEach((each, index) =>
            ready.set(each.slot, { unit: each, bytes: bytes[index] })
          ),
        (error) => {
          const where =
            batch.length > 1
              ? memberName(volume, unit.member)
              : unitName(volume, unit);
          settle(failed(batch, unitFailure(where, 'read', error)));
        }
      )
      .finally(() => {
        if (probe) probing.delete(unit.member);
        reading -= 1;
        pump();
      });
  };

  const written = (unit: Unit, pixels: DecodedPixels): VolumeUpdate => {
    try {
      return write(volume, unit, pixels);
    } catch (error) {
      return failed([unit], error);
    }
  };

  const startDecode = (slot: number) => {
    const { unit, bytes } = ready.get(slot)!;
    ready.delete(slot);
    decoding += 1;
    Promise.resolve()
      .then(() => {
        stopped.throwIfAborted();
        return unit.decode(bytes, stopped);
      })
      .then(
        (pixels) => (stopped.aborted ? undefined : written(unit, pixels)),
        (error) =>
          failed([unit], unitFailure(unitName(volume, unit), 'decoded', error))
      )
      .then((update) => {
        decoding -= 1;
        if (update) settle(update);
        pump();
      });
  };

  const claimable = () =>
    [...waiting.values()]
      .filter((unit) => !probing.has(unit.member))
      .map((unit) => unit.slot);

  const nextDecode = () =>
    !stopped.aborted && decoding < runtime.decodeConcurrency
      ? next(ready.keys())
      : undefined;
  const nextRead = () =>
    !stopped.aborted && reading + ready.size < runtime.readConcurrency
      ? next(claimable())
      : undefined;

  function pump() {
    for (let slot = nextDecode(); slot !== undefined; slot = nextDecode())
      startDecode(slot);
    for (let slot = nextRead(); slot !== undefined; slot = nextRead())
      startRead(waiting.get(slot)!);
    notify();
  }

  const done = () => waiting.size + ready.size + reading + decoding === 0;

  return { start: pump, updates, changed, done };
}

/**
 * Decodes the slices not yet loaded, the focused slot first and then coarse
 * to fine, writing each into the volume's buffer as it decodes and marking it
 * loaded as its update is yielded. Each instance loads in the units its first
 * willing decoder in the runtime's table plans. Reads run ahead of decoding in
 * the same order. A failed unit yields an error update and loading goes on.
 * Aborting `signal`, disposing the runtime or leaving the loop stops reads and
 * decodes; the iteration then returns rather than throwing, and yields
 * nothing more.
 */
export async function* loadVolume(
  volume: Volume,
  { runtime, signal, focus = () => middleSlot(volume) }: LoadVolumeOptions
) {
  const { controller, release } = linkedController(signal, runtime.signal);
  const stopped = controller.signal;
  const loader = createLoader({ volume, runtime, stopped, focus });
  loader.start();
  try {
    for (;;) {
      const next = stopped.aborted ? undefined : loader.updates.shift();
      if (next) {
        markLoaded(volume, next);
        yield next;
      } else if (stopped.aborted || loader.done()) return;
      else await loader.changed();
    }
  } finally {
    controller.abort(abortError('DICOM volume loading stopped'));
    release();
  }
}
