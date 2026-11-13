import { afterEach, describe, expect, it } from 'vitest';
import {
  createDicomRuntime,
  type DicomRuntime,
} from '../../runtime/createDicomRuntime';
import type { WholeInstanceDecode } from '../../pixels/pixelDecoder';
import { singleDecoderTable } from '../../pixels/decoderTable';
import type { GdcmLane } from '../../runtime/gdcmDecoder';
import { defer } from '../../utils';
import { hangingSource } from '@/tests/byteSourceFixtures';
import { loadedRange, type Volume } from '../allocateVolume';
import type { ByteSource } from '../../source/byteSource';
import {
  loadVolume,
  type LoadVolumeOptions,
  type VolumeUpdate,
} from '../loadVolume';
import {
  allocated,
  pixelSlice,
  slicePixels,
  sliceValues,
  valueDecoder,
} from './volumeFixture';
import { decodingWith } from '@/tests/dicomVolumeFixtures';

const runtimes: DicomRuntime[] = [];
afterEach(() => runtimes.splice(0).forEach((runtime) => runtime.dispose()));

const runtimeWith = (decoder: WholeInstanceDecode, decodeConcurrency = 1) => {
  const runtime = createDicomRuntime({
    ...decodingWith(decoder),
    decodeConcurrency,
  });
  runtimes.push(runtime);
  return runtime;
};

const collect = async (updates: AsyncIterable<VolumeUpdate>) => {
  const all: VolumeUpdate[] = [];
  for await (const update of updates) all.push(update);
  return all;
};

const loadAll = (
  volume: Volume,
  runtime: DicomRuntime,
  options: Pick<LoadVolumeOptions, 'focus' | 'readAhead'> = {}
) =>
  collect(
    loadVolume(volume, {
      runtime,
      signal: new AbortController().signal,
      ...options,
    })
  );

/** Slices whose sources report each read as it starts, in order. */
const recordedStack = (count: number) => {
  const reads: number[] = [];
  const started: Array<() => void> = [];
  const readStarted = (wanted: number) =>
    new Promise<void>((resolve) => {
      if (reads.length >= wanted) resolve();
      else started.push(() => reads.length >= wanted && resolve());
    });
  const members = Array.from({ length: count }, (_, z) => {
    const instance = pixelSlice(z);
    const source: ByteSource = {
      read: (signal, range) => {
        reads.push(z);
        started.forEach((check) => check());
        return instance.source.read(signal, range);
      },
    };
    return { ...instance, source };
  });
  return { volume: allocated(members), reads, readStarted };
};

const stack = (count: number) => recordedStack(count).volume;

describe('loadVolume', () => {
  it('fills every slice, the middle first and then coarse to fine', async () => {
    const decoded: number[] = [];
    const { volume, reads } = recordedStack(5);

    const updates = await loadAll(volume, runtimeWith(valueDecoder(decoded)), {
      readAhead: 1,
    });

    expect(reads).toEqual([2, 0, 4, 1, 3]);
    expect(decoded).toEqual([2, 0, 4, 1, 3]);
    expect(updates.map((update) => update.slot)).toEqual(decoded);
    expect(updates[0]).toEqual({
      slot: 2,
      extent: [0, 3, 0, 3, 2, 2],
      range: [[2, 2]],
    });
    expect(sliceValues(volume)).toEqual([0, 1, 2, 3, 4]);
    expect(loadedRange(volume)).toEqual([[0, 4]]);
  });

  it('reports a failed slice and keeps loading the rest', async () => {
    const decode = valueDecoder();
    const decoder: WholeInstanceDecode = async (request, signal) => {
      const image = await decode(request, signal);
      if (image.data[0] === 1) throw new Error('corrupt pixel data');
      if (image.data[0] === 3) return { ...image, size: [2, 8, 1] as const };
      return image;
    };
    const volume = stack(5);

    const updates = await loadAll(volume, runtimeWith(decoder));

    const errors = updates.flatMap((update) =>
      'error' in update ? [[update.slot, update.error.message]] : []
    );
    expect(errors).toEqual([
      [1, 'corrupt pixel data'],
      [3, expect.stringMatching(/does not fit the volume/)],
    ]);
    expect(sliceValues(volume)).toEqual([0, null, 2, null, 4]);
  });

  it('reorders reads around a focus that moves while a slice decodes', async () => {
    const decoded: number[] = [];
    const decode = valueDecoder(decoded);
    const resume = defer<void>();
    const decoder: WholeInstanceDecode = async (request, signal) => {
      const image = await decode(request, signal);
      if (decoded.length === 1) await resume.promise;
      return image;
    };
    let focus = 4;
    const { volume, reads, readStarted } = recordedStack(9);

    const loading = loadAll(volume, runtimeWith(decoder), {
      focus: () => focus,
      readAhead: 1,
    });
    // Slice 4 is decoding and the one read allowed ahead has begun.
    await readStarted(2);
    focus = 7;
    resume.resolve();
    await loading;

    expect(reads).toEqual([4, 0, 7, 3, 5, 1, 6, 8, 2]);
    expect(decoded).toEqual(reads);
  });

  it('reads ahead of a busy decoder, holding at most readAhead undecoded', async () => {
    const readAhead = 3;
    const decodesStarted: number[] = [];
    const decode = valueDecoder();
    const { volume, reads, readStarted } = recordedStack(8);
    let mostOutstanding = 0;
    const ahead = readStarted(1 + readAhead);
    const decoder: WholeInstanceDecode = async (request, signal) => {
      decodesStarted.push(0);
      mostOutstanding = Math.max(
        mostOutstanding,
        reads.length - decodesStarted.length
      );
      // The first decode waits until the reads behind it have all started.
      if (decodesStarted.length === 1) await ahead;
      return decode(request, signal);
    };

    const updates = await loadAll(volume, runtimeWith(decoder), { readAhead });

    expect(updates).toHaveLength(8);
    expect(reads).toHaveLength(8);
    expect(mostOutstanding).toBeLessThanOrEqual(readAhead);
  });

  it('runs at most decodeConcurrency decodes at once', async () => {
    let active = 0;
    let peak = 0;
    const gate = defer<void>();
    const twoStarted = defer<void>();
    const decode = valueDecoder();
    const decoder: WholeInstanceDecode = async (request, signal) => {
      active += 1;
      peak = Math.max(peak, active);
      if (active === 2) twoStarted.resolve();
      await gate.promise;
      active -= 1;
      return decode(request, signal);
    };

    const loading = loadAll(stack(5), runtimeWith(decoder, 2));
    await twoStarted.promise;
    gate.resolve();

    expect(await loading).toHaveLength(5);
    expect(peak).toBe(2);
  });

  it('reports a failed read and keeps loading the rest', async () => {
    const failing: ByteSource = {
      read: () =>
        new ReadableStream({
          pull: (controller) => controller.error(new Error('connection reset')),
        }),
    };
    const volume = allocated([
      pixelSlice(0),
      { ...pixelSlice(1), source: failing },
      pixelSlice(2),
    ]);

    const updates = await loadAll(volume, runtimeWith(valueDecoder()));

    expect(
      updates.flatMap((update) =>
        'error' in update ? [[update.slot, update.error.message]] : []
      )
    ).toEqual([[1, 'connection reset']]);
    expect(sliceValues(volume)).toEqual([0, null, 2]);
  });

  it('stops reading and yields nothing more once aborted', async () => {
    const decoded: number[] = [];
    const [below, above] = [hangingSource(), hangingSource()];
    const volume = allocated([
      { ...pixelSlice(0), source: below.source },
      pixelSlice(1),
      { ...pixelSlice(2), source: above.source },
    ]);
    const controller = new AbortController();
    const updates = loadVolume(volume, {
      runtime: runtimeWith(valueDecoder(decoded), 2),
      signal: controller.signal,
    })[Symbol.asyncIterator]();

    const first = await updates.next();
    await Promise.all([below.pulled, above.pulled]);
    const reason = new DOMException('closed', 'AbortError');
    controller.abort(reason);

    expect(first.value).toMatchObject({ slot: 1 });
    expect(await updates.next()).toEqual({ done: true, value: undefined });
    expect(await below.cancelled).toBe(reason);
    expect(await above.cancelled).toBe(reason);
    expect(decoded).toEqual([1]);
    expect(sliceValues(volume)).toEqual([null, 1, null]);
  });

  it('ends when the runtime is disposed during a decode', async () => {
    const started = defer<void>();
    const decoder: WholeInstanceDecode = () => {
      started.resolve();
      return new Promise(() => {});
    };
    const runtime = runtimeWith(decoder);

    const loading = loadAll(stack(2), runtime);
    await started.promise;
    runtime.dispose();

    expect(await loading).toEqual([]);
  });

  it('keeps decoding while the consumer waits, marking slices loaded only as they are yielded', async () => {
    const decoded: number[] = [];
    const decode = valueDecoder(decoded);
    const lastStarted = defer<void>();
    const decoder: WholeInstanceDecode = (request, signal) => {
      if (decoded.length === 4) lastStarted.resolve();
      return decode(request, signal);
    };
    const volume = stack(5);
    const updates = loadVolume(volume, {
      runtime: runtimeWith(decoder),
      signal: new AbortController().signal,
    })[Symbol.asyncIterator]();

    const first = await updates.next();
    // One decode at a time, so the fifth starts only after four were written.
    await lastStarted.promise;

    expect(first.value).toMatchObject({ slot: 2 });
    expect(decoded.slice(0, 4).map((slice) => volume.data[slice * 16])).toEqual(
      decoded.slice(0, 4)
    );
    expect(sliceValues(volume)).toEqual([null, null, 2, null, null]);
    const rest: VolumeUpdate[] = [];
    for (
      let next = await updates.next();
      !next.done;
      next = await updates.next()
    )
      rest.push(next.value);
    expect(rest.map((update) => update.slot)).toEqual(decoded.slice(1));
    expect(sliceValues(volume)).toEqual([0, 1, 2, 3, 4]);
  });

  it('writes nothing into the buffer once aborted', async () => {
    const controller = new AbortController();
    // Returning synchronously queues any write ahead of the load's own return.
    const decoder: WholeInstanceDecode = ({ bytes }) => {
      controller.abort();
      return slicePixels(bytes);
    };
    const volume = stack(3);

    const updates = await collect(
      loadVolume(volume, {
        runtime: runtimeWith(decoder),
        signal: controller.signal,
      })
    );

    expect(updates).toEqual([]);
    expect(volume.data.every((sample) => sample === 0)).toBe(true);
    expect(sliceValues(volume)).toEqual([null, null, null]);
  });

  it('ends and stops the GDCM worker when the runtime is disposed mid-decode', async () => {
    const started = defer<void>();
    const resets: unknown[] = [];
    const hangingLane = (): GdcmLane => ({
      run: () => {
        started.resolve();
        return new Promise(() => {});
      },
      reset: (reason) => resets.push(reason),
    });
    const runtime = createDicomRuntime(
      {
        assets: { pipelineWorkerUrl: '/unused', imageIOUrl: '/unused' },
        decoders: singleDecoderTable,
        decodeConcurrency: 1,
      },
      hangingLane
    );
    runtimes.push(runtime);

    const loading = loadAll(stack(2), runtime);
    await started.promise;
    runtime.dispose();

    expect(await loading).toEqual([]);
    expect(resets).not.toHaveLength(0);
    expect(resets[0]).toMatchObject({ name: 'AbortError' });
  });

  it('carries decoded slices into a grown volume without decoding them again', async () => {
    const decoded: number[] = [];
    const runtime = runtimeWith(valueDecoder(decoded));
    const [first, middle, last] = [0, 1, 2].map((z) => pixelSlice(z));
    const sparse = allocated([first, last]);
    await loadAll(sparse, runtime);

    const grown = allocated([first, middle, last], sparse);
    expect(sliceValues(grown)).toEqual([0, null, 2]);
    decoded.length = 0;
    await loadAll(grown, runtime);
    expect(decoded).toEqual([1]);

    decoded.length = 0;
    expect(await loadAll(grown, runtime)).toEqual([]);
    expect(decoded).toEqual([]);
  });

  it('copies nothing into a volume whose buffer type changed', async () => {
    const runtime = runtimeWith(valueDecoder());
    const [first, last] = [0, 2].map((z) => pixelSlice(z));
    const unsigned = allocated([first, last]);
    await loadAll(unsigned, runtime);

    const signed = pixelSlice(1, { tags: { '0028|0103': '1' } });
    const grown = allocated([first, signed, last], unsigned);

    expect(grown.data).toBeInstanceOf(Float32Array);
    expect(sliceValues(grown)).toEqual([null, null, null]);
  });
});
