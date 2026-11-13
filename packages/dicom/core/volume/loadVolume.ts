import type { DicomRuntime } from '../runtime/createDicomRuntime';
import type { Instance } from '../instance/readInstance';
import { getDatasetTag } from '../metadata/datasetAccess';
import { Tags } from '../metadata/dicomTags';
import { numberOr } from '../utils';
import { abortError, linkedController } from '../utils';
import { readBytes } from '../source/byteSource';
import { planDecode, type DecoderTable } from '../pixels/decoderTable';
import {
  frameCount,
  type DecodedPixels,
  type DecodeUnit,
} from '../pixels/pixelDecoder';
import { getPixelFormat, type VolumeBufferConstructor } from './pixelFormat';
import {
  componentRanges,
  memberLoaded,
  memberSlices,
  sliceLength,
  type Volume,
} from './allocateVolume';
import {
  assertSamplesRepresentable,
  assertSingleFramePerFile,
  assertUnitFits,
  type UnitShape,
} from './pixelValidation';
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
  /** Read before every read and decode; defaults to the middle member's slot. */
  focus?: () => number;
  /**
   * Units being read or read but not yet decoding, which bounds both
   * concurrent reads and undecoded bytes held. Defaults to the runtime's
   * read concurrency.
   */
  readAhead?: number;
};

/** A planned unit placed in the volume; `slot` is its first slice. */
type Unit = DecodeUnit &
  Readonly<{ member: number; slices: readonly number[]; slot: number }>;

const ensureError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

const sliceExtent = (volume: Volume, slices: readonly number[]): Extent => [
  0,
  volume.dimensions[0] - 1,
  0,
  volume.dimensions[1] - 1,
  Math.min(...slices),
  Math.max(...slices),
];

const failure = (
  volume: Volume,
  slices: readonly number[],
  error: unknown
): VolumeUpdate => ({
  slot: Math.min(...slices),
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

function headerShape(instance: Instance): UnitShape {
  const value = (tag: string, fallback: number) =>
    numberOr(getDatasetTag(instance.dataset, tag), fallback);
  const [columns, rows] = [value(Tags.Columns, 0), value(Tags.Rows, 0)];
  const components = value(Tags.SamplesPerPixel, 1);
  const frames = frameCount(instance);
  return {
    size: [columns, rows, frames],
    components,
    samples: columns * rows * frames * components,
  };
}

const roomFor = (volume: Volume, frames: number) => ({
  dims: volume.dimensions,
  components: volume.components,
  frames,
  multiFile: volume.members.length > 1,
});

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

/** Validates decoded pixels and writes them into the buffer. */
function write(volume: Volume, unit: Unit, pixels: DecodedPixels) {
  const where = unitName(volume, unit);
  const { data, size, components } = pixels;
  assertUnitFits(
    { size, components, samples: data.length },
    roomFor(volume, unit.frames),
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

/** Whether the units cover frames 0 to `frames - 1` exactly once, in any order. */
const tiles = (units: readonly DecodeUnit[], frames: number) => {
  const covered = units.flatMap((unit) =>
    Array.from({ length: unit.frames }, (_, index) => unit.firstFrame + index)
  );
  return (
    units.every((unit) => Number.isInteger(unit.frames) && unit.frames >= 1) &&
    covered.length === frames &&
    covered.every(
      (frame) => Number.isInteger(frame) && frame >= 0 && frame < frames
    ) &&
    new Set(covered).size === frames
  );
};

function planMember(volume: Volume, member: number, decoders: DecoderTable) {
  const instance = volume.members[member];
  const slices = memberSlices(volume, member);
  const target = volume.data.constructor as VolumeBufferConstructor;
  const planned = planDecode(decoders, instance, target);
  if ('error' in planned) throw planned.error;
  const where = memberName(volume, member);
  const header = headerShape(instance);
  assertSingleFramePerFile(header.size[2], volume.members.length, where);
  assertUnitFits(header, roomFor(volume, slices.length), where);
  if (!tiles(planned.units, slices.length))
    throw new Error(
      `${planned.decoder.name} planned units that do not cover frames 0 to ${slices.length - 1} of ${where} exactly once`
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

/** The first slice of the middle member, the default focus. */
export const middleSlot = (volume: Volume) =>
  memberSlices(volume, Math.floor(volume.members.length / 2))[0];

type Loader = {
  volume: Volume;
  runtime: LoadVolumeOptions['runtime'];
  stopped: AbortSignal;
  focus: () => number;
  readAhead: number;
};

/** An update waiting to be yielded, with the slices it marks loaded then. */
type Settled = Readonly<{ update: VolumeUpdate; slices: readonly number[] }>;

/**
 * Starts reads and decodes whenever one settles: decodes first, up to the
 * decode concurrency, then reads while fewer than `readAhead` units are being
 * read or wait to decode. A decoded unit is written at once, so decoding never
 * waits for the consumer.
 */
function createLoader({ volume, runtime, stopped, focus, readAhead }: Loader) {
  const { units, failures } = planUnits(volume, runtime.decoders);
  const waiting = new Map(units.map((unit) => [unit.slot, unit]));
  const ready = new Map<number, { unit: Unit; bytes: Uint8Array }>();
  /** Members whose source has not yet shown it honours ranges. */
  const probing = new Set<number>();
  const updates: Settled[] = failures.map((update) => ({
    update,
    slices: [],
  }));
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

  const settle = (settled: Settled) => {
    if (!stopped.aborted) updates.push(settled);
    notify();
  };
  const failed = (lost: Unit[], error: unknown): Settled => ({
    update: failure(
      volume,
      lost.flatMap((unit) => unit.slices),
      error
    ),
    slices: [],
  });
  const next = (slots: Iterable<number>) => pickNextSlot(slots, focus());
  const sourceOf = (unit: Unit) => volume.members[unit.member].source;
  const rangeSupport = (unit: Unit) =>
    sourceOf(unit).rangeSupport?.() ?? 'honoured';

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
    const start = Math.min(...batch.map((unit) => unit.range!.start));
    const end = Math.max(...batch.map((unit) => unit.range!.end!));
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
        (error) => settle(failed(batch, error))
      )
      .finally(() => {
        if (probe) probing.delete(unit.member);
        reading -= 1;
        pump();
      });
  };

  const written = (unit: Unit, pixels: DecodedPixels): Settled => {
    try {
      return { update: write(volume, unit, pixels), slices: unit.slices };
    } catch (error) {
      return failed([unit], error);
    }
  };

  const startDecode = (slot: number) => {
    const { unit, bytes } = ready.get(slot)!;
    ready.delete(slot);
    decoding += 1;
    (async () => unit.decode(bytes, stopped))()
      .then(
        (pixels) => (stopped.aborted ? undefined : written(unit, pixels)),
        (error) => failed([unit], error)
      )
      .then((settled) => {
        decoding -= 1;
        if (settled) settle(settled);
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
    !stopped.aborted && reading + ready.size < readAhead
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
 * loaded as its update is yielded. Each instance loads in the
 * units its first willing decoder in the runtime's table plans. Reads run
 * ahead of decoding in the same order. A failed unit yields an error update
 * and loading goes on. Aborting `signal`, disposing the runtime or leaving
 * the loop stops reads and decodes; the iteration then returns rather than
 * throwing, and yields nothing more.
 */
export async function* loadVolume(
  volume: Volume,
  {
    runtime,
    signal,
    focus = () => middleSlot(volume),
    readAhead = runtime.readConcurrency,
  }: LoadVolumeOptions
): AsyncGenerator<VolumeUpdate, void, undefined> {
  if (!Number.isInteger(readAhead) || readAhead < 1)
    throw new Error('Read ahead must be a positive integer');
  const { controller, release } = linkedController(signal, runtime.signal);
  const stopped = controller.signal;
  const loader = createLoader({ volume, runtime, stopped, focus, readAhead });
  loader.start();
  try {
    for (;;) {
      const next = stopped.aborted ? undefined : loader.updates.shift();
      if (next) {
        next.slices.forEach((slice) => {
          volume.loaded[slice] = 1;
        });
        yield next.update;
      } else if (stopped.aborted || loader.done()) return;
      else await loader.changed();
    }
  } finally {
    controller.abort(abortError('DICOM volume loading stopped'));
    release();
  }
}
