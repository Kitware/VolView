import type { DecodedDicomImage } from '../runtime/decoder';
import type { DicomRuntime } from '../runtime/createDicomRuntime';
import { getDatasetTag } from '../metadata/datasetAccess';
import { Tags } from '../metadata/dicomTags';
import { abortError, linkedController } from '../utils/abort';
import {
  readBytes,
  type ByteRange,
  type ByteSource,
} from '../source/byteSource';
import {
  planDecode,
  type DecodePlan,
  type DecoderTable,
} from '../pixels/decoderTable';
import {
  instancePixelFormats,
  type VolumeBufferConstructor,
} from './pixelFormat';
import {
  componentRanges,
  memberLoaded,
  memberSlices,
  sliceLength,
  type Volume,
} from './allocateVolume';
import {
  assertChunkFitsSlot,
  assertSamplesRepresentable,
  assertSingleFramePerFile,
  type DecodedChunkImage,
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
    'decode' | 'decoders' | 'decodeConcurrency' | 'readConcurrency' | 'signal'
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

const memberName = (volume: Volume, member: number) => {
  const sop = getDatasetTag(
    volume.members[member].dataset,
    Tags.SOPInstanceUID
  );
  return `File ${sop ?? 'without SOP Instance UID'} (member ${member})`;
};

function assertMemberFits(
  volume: Volume,
  member: number,
  image: DecodedChunkImage
) {
  const { dimensions, components, members } = volume;
  const where = memberName(volume, member);
  assertSingleFramePerFile(image.size[2], members.length, where);
  assertChunkFitsSlot(
    image,
    {
      dims: [...dimensions],
      componentCount: components,
      count: members.length,
    },
    where
  );
}

type Rescale = { rescaleSlope: number; rescaleIntercept: number };

function assertRepresentable(
  volume: Volume,
  {
    samples,
    range,
  }: { samples: ArrayLike<number>; range: Array<[number, number]> },
  where: string,
  rescales: readonly Rescale[]
) {
  assertSamplesRepresentable(
    samples,
    {
      min: Math.min(...range.map(([min]) => min)),
      max: Math.max(...range.map(([, max]) => max)),
    },
    volume.data,
    { where, rescales }
  );
}

/** A Float32 volume holds rounded values, so the range it reports is rounded too. */
const storedRange = (volume: Volume, range: Array<[number, number]>) =>
  volume.data instanceof Float32Array
    ? range.map(([min, max]): [number, number] => [
        Math.fround(min),
        Math.fround(max),
      ])
    : range;

function writeMember(volume: Volume, member: number, image: DecodedDicomImage) {
  assertMemberFits(volume, member, image);
  const range = componentRanges(image.data, volume.components);
  assertRepresentable(
    volume,
    { samples: image.data, range },
    memberName(volume, member),
    instancePixelFormats(volume.members[member].dataset)
  );
  const slices = memberSlices(volume, member);
  volume.data.set(image.data, sliceLength(volume) * slices[0]);
  slices.forEach((slice) => {
    volume.loaded[slice] = 1;
  });
  return {
    slot: slices[0],
    extent: sliceExtent(volume, slices),
    range: storedRange(volume, range),
  };
}

type FramePlan = Extract<DecodePlan, { kind: 'frames' }>;

function writeFrame(
  volume: Volume,
  unit: FrameUnit,
  plan: FramePlan,
  bytes: Uint8Array
) {
  const { samples, range } = plan.decode(
    bytes,
    plan.format,
    volume.data.constructor as VolumeBufferConstructor
  );
  const where = `${memberName(volume, unit.member)}, frame ${unit.frame}`;
  assertRepresentable(volume, { samples, range }, where, [plan.format]);
  volume.data.set(samples, sliceLength(volume) * unit.slot);
  volume.loaded[unit.slot] = 1;
  return {
    slot: unit.slot,
    extent: sliceExtent(volume, [unit.slot]),
    range: storedRange(volume, range),
  };
}

type WholeUnit = Readonly<{ kind: 'instance'; slot: number; member: number }>;
type FrameUnit = Readonly<{
  kind: 'frame';
  slot: number;
  member: number;
  frame: number;
  range: ByteRange;
}>;
type Unit = WholeUnit | FrameUnit;

/**
 * Units still to load and failures known from headers alone. An indexable
 * instance contributes a unit per frame; any other one is a single unit.
 */
function planUnits(
  volume: Volume,
  decoders: DecoderTable
): { units: Unit[]; plans: DecodePlan[]; failures: VolumeUpdate[] } {
  const units: Unit[] = [];
  const failures: VolumeUpdate[] = [];
  const plans = volume.members.map((instance, member) => {
    const plan = planDecode(decoders, instance);
    const slices = memberSlices(volume, member);
    const fail = (error: Error) =>
      failures.push({
        slot: slices[0],
        extent: sliceExtent(volume, slices),
        error,
      });
    if (memberLoaded(volume, member)) return plan;
    if (plan.kind === 'unsupported') fail(plan.error);
    else if (plan.kind === 'whole-instance')
      units.push({ kind: 'instance', slot: slices[0], member });
    else {
      try {
        const { rows, columns, samplesPerPixel } = plan.format;
        const frames = plan.index.frames.length;
        assertMemberFits(volume, member, {
          size: [columns, rows, frames],
          data: { length: columns * rows * frames * samplesPerPixel },
          imageType: { components: samplesPerPixel },
        });
        plan.index.frames.forEach((range, frame) => {
          const slot = slices[frame];
          if (!volume.loaded[slot])
            units.push({ kind: 'frame', slot, member, frame, range });
        });
      } catch (error) {
        fail(ensureError(error));
      }
    }
    return plan;
  });
  return { units, plans, failures };
}

/** The first slice of the middle member, the default focus. */
export const middleSlot = (volume: Volume) =>
  memberSlices(volume, Math.floor(volume.members.length / 2))[0];

/** Wakes every waiter on any change; checks and waits happen in one turn. */
function changes() {
  const waiters: Array<() => void> = [];
  return {
    notify: () => waiters.splice(0).forEach((wake) => wake()),
    next: () =>
      new Promise<void>((resolve) => {
        waiters.push(resolve);
      }),
  };
}

type Lanes = {
  volume: Volume;
  runtime: LoadVolumeOptions['runtime'];
  stopped: AbortSignal;
  focus: () => number;
};

const rangeSupport = (source: ByteSource) =>
  source.rangeSupport?.() ?? 'honoured';

function createLanes({ volume, runtime, stopped, focus }: Lanes) {
  const { units, plans, failures } = planUnits(volume, runtime.decoders);
  const unitAt = new Map(units.map((unit) => [unit.slot, unit]));
  const framesOf = (member: number) =>
    units.filter((unit) => unit.kind === 'frame' && unit.member === member);
  const claimed = new Set<number>();
  /** Multiframe members whose source has not yet shown it honours ranges. */
  const probing = new Set<number>();
  const fetched = new Map<number, Uint8Array>();
  const updates: VolumeUpdate[] = [...failures];
  const changed = changes();
  let reading = 0;
  let readers = 0;
  stopped.addEventListener('abort', changed.notify, { once: true });

  const loaded = (unit: Unit) =>
    unit.kind === 'frame'
      ? volume.loaded[unit.slot] === 1
      : memberLoaded(volume, unit.member);
  const failure = (slots: number[], error: unknown): VolumeUpdate => ({
    slot: Math.min(...slots),
    extent: sliceExtent(
      volume,
      slots.flatMap((slot) => {
        const unit = unitAt.get(slot)!;
        return unit.kind === 'frame'
          ? [slot]
          : memberSlices(volume, unit.member);
      })
    ),
    error: ensureError(error),
  });
  const unclaimed = () =>
    units
      .filter(
        (unit) =>
          !claimed.has(unit.slot) && !probing.has(unit.member) && !loaded(unit)
      )
      .map((unit) => unit.slot);

  // A server that ignores Range would resend the file for every frame, so
  // such a member's remaining frames come from one read of its pixel data.
  const pending = (unit: FrameUnit) =>
    rangeSupport(volume.members[unit.member].source) === 'ignored'
      ? framesOf(unit.member).filter(
          (other) =>
            other === unit || (!claimed.has(other.slot) && !loaded(other))
        )
      : [unit];

  const readFrames = async (frames: Unit[]) => {
    const ranges = frames.map((unit) => (unit as FrameUnit).range);
    const start = Math.min(...ranges.map((range) => range.start));
    const end = Math.max(...ranges.map((range) => range.end!));
    const bytes = await readBytes(
      volume.members[frames[0].member].source,
      stopped,
      { start, end }
    );
    ranges.forEach((range, index) =>
      fetched.set(
        frames[index].slot,
        bytes.subarray(range.start - start, range.end! - start)
      )
    );
  };

  const read = async (unit: Unit) => {
    const { source } = volume.members[unit.member];
    const frames = unit.kind === 'frame' ? pending(unit) : [unit];
    frames.forEach((each) => claimed.add(each.slot));
    const plan = plans[unit.member];
    const probe =
      plan.kind === 'frames' &&
      plan.index.frames.length > 1 &&
      rangeSupport(source) === 'unknown';
    if (probe) probing.add(unit.member);
    reading += 1;
    try {
      if (unit.kind === 'frame') await readFrames(frames);
      else fetched.set(unit.slot, await readBytes(source, stopped));
    } catch (error) {
      if (!stopped.aborted)
        updates.push(
          failure(
            frames.map((each) => each.slot),
            error
          )
        );
    } finally {
      if (probe) probing.delete(unit.member);
      reading -= 1;
      changed.notify();
    }
  };
  const decode = async (slot: number, bytes: Uint8Array) => {
    const unit = unitAt.get(slot)!;
    if (unit.kind === 'frame') {
      stopped.throwIfAborted();
      return writeFrame(volume, unit, plans[unit.member] as FramePlan, bytes);
    }
    const instance = volume.members[unit.member];
    const image = await runtime.decode({ instance, bytes }, stopped);
    stopped.throwIfAborted();
    return writeMember(volume, unit.member, image);
  };
  const settle = async (slot: number, bytes: Uint8Array) => {
    try {
      updates.push(await decode(slot, bytes));
    } catch (error) {
      if (!stopped.aborted) updates.push(failure([slot], error));
    }
  };

  const reader = async (readAhead: number) => {
    while (!stopped.aborted) {
      if (reading + fetched.size >= readAhead) await changed.next();
      else {
        const slot = pickNextSlot(unclaimed(), focus());
        if (slot !== undefined) await read(unitAt.get(slot)!);
        else if (probing.size === 0) return;
        else await changed.next();
      }
    }
  };

  const decoder = async () => {
    while (!stopped.aborted) {
      const slot = pickNextSlot(fetched.keys(), focus());
      if (slot !== undefined) {
        const bytes = fetched.get(slot)!;
        fetched.delete(slot);
        changed.notify();
        await settle(slot, bytes);
        changed.notify();
      } else if (readers === 0) return;
      else await changed.next();
    }
  };

  const start = (readAhead: number) => {
    readers = readAhead;
    Array.from({ length: readAhead }).forEach(() =>
      reader(readAhead).finally(() => {
        readers -= 1;
        changed.notify();
      })
    );
    return Promise.all(
      Array.from({ length: runtime.decodeConcurrency }, decoder)
    );
  };

  return { start, updates, changed };
}

/**
 * Decodes the slices not yet loaded, the focused slot first and then coarse
 * to fine, writing each into the volume's buffer. An uncompressed instance
 * loads frame by frame from ranged reads; any other one is read and decoded
 * whole. Reads run ahead of decoding in the same order. A failed unit yields
 * an error update and loading goes on. Aborting `signal`, disposing the runtime or leaving the loop stops reads
 * and decodes; the iteration then returns rather than throwing, and yields
 * nothing more.
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
  const lanes = createLanes({ volume, runtime, stopped, focus });
  let finished = false;
  lanes.start(readAhead).finally(() => {
    finished = true;
    lanes.changed.notify();
  });
  try {
    for (;;) {
      const next = stopped.aborted ? undefined : lanes.updates.shift();
      if (next) yield next;
      else if (stopped.aborted || finished) return;
      else await lanes.changed.next();
    }
  } finally {
    controller.abort(abortError('DICOM volume loading stopped'));
    release();
  }
}
