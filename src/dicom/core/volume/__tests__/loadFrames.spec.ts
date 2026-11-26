import { afterEach, describe, expect, it } from 'vitest';
import {
  createDicomRuntime,
  type DicomRuntime,
} from '../../runtime/createDicomRuntime';
import { readInstance } from '../../instance/readInstance';
import {
  fromBlob,
  fromUrl,
  type ByteRange,
  type ByteSource,
} from '../../source/byteSource';
import { loadVolume, type VolumeUpdate } from '../loadVolume';
import { defaultDecoderTable } from '../../pixels/decoderTable';
import type { DecodeUnit, PixelDecoder } from '../../pixels/pixelDecoder';
import { allocated } from './volumeFixture';
import {
  nativePixelDicom,
  patternWords,
  type NativePixelOptions,
} from '@/tests/nativePixelDicom';

const runtimes: DicomRuntime[] = [];
afterEach(() => runtimes.splice(0).forEach((runtime) => runtime.dispose()));

/** No decoder assets: anything not decoded natively fails loudly. */
const nativeOnly = () => {
  const runtime = createDicomRuntime({});
  runtimes.push(runtime);
  return runtime;
};

const signal = () => new AbortController().signal;

/** A source that records the range of every read it opens. */
const recorded = (source: ByteSource) => {
  const ranges: Array<ByteRange | undefined> = [];
  return {
    ranges,
    source: {
      ...source,
      read: (readSignal: AbortSignal, range?: ByteRange) => {
        ranges.push(range);
        return source.read(readSignal, range);
      },
    } satisfies ByteSource,
  };
};

const blobOf = (bytes: Uint8Array) =>
  fromBlob(new Blob([bytes as Uint8Array<ArrayBuffer>]));

const load = async (
  members: Awaited<ReturnType<typeof readInstance>>[],
  options: {
    readConcurrency?: number;
    abort?: AbortSignal;
    runtime?: DicomRuntime;
  } = {}
) => {
  const volume = allocated(members);
  const runtime = options.runtime ?? nativeOnly();
  const updates: VolumeUpdate[] = [];
  for await (const update of loadVolume(volume, {
    runtime: {
      ...runtime,
      readConcurrency: options.readConcurrency ?? runtime.readConcurrency,
    },
    signal: options.abort ?? signal(),
  }))
    updates.push(update);
  return { volume, updates };
};

const FRAMES = 5;
const multiframe = (options: NativePixelOptions = {}) => {
  const words = patternWords(FRAMES * 6, 16);
  return {
    words,
    bytes: nativePixelDicom({
      rows: 2,
      columns: 3,
      frames: FRAMES,
      words,
      ...options,
    }),
  };
};

/** One failure that spans every frame of `multiframe()`. */
const failsWhole = (message: RegExp) => [
  {
    slot: 0,
    extent: [0, 2, 0, 1, 0, FRAMES - 1],
    error: expect.objectContaining({
      message: expect.stringMatching(message),
    }),
  },
];

/** Frame `frame` of `multiframe()`, read from its own range. */
const frameUnit = (valueOffset: number, frame: number): DecodeUnit => {
  const start = valueOffset + frame * 12;
  return {
    firstFrame: frame,
    frames: 1,
    range: { start, end: start + 12 },
    decode: (frameBytes) => ({
      data: new Uint16Array(frameBytes.slice().buffer),
      size: [3, 2, 1],
      components: 1,
    }),
  };
};

/** A runtime whose table tries `decoder` first for transfer syntax `codec`. */
const runtimeFor = (codec: string, decoder: PixelDecoder) => {
  const runtime = createDicomRuntime({
    decoders: (decoders) => {
      const table = defaultDecoderTable(decoders);
      return {
        ...table,
        byTransferSyntax: new Map([
          ...table.byTransferSyntax,
          [codec, [decoder, decoders.gdcm]],
        ]),
      };
    },
  });
  runtimes.push(runtime);
  return runtime;
};

describe('loadVolume with native frames', () => {
  it('loads each frame of a multiframe instance from its own ranged read', async () => {
    const { bytes, words } = multiframe();
    const { source, ranges } = recorded(blobOf(bytes));
    const instance = await readInstance(source, signal());

    const { volume, updates } = await load([instance], { readConcurrency: 1 });

    const start = instance.pixelData!.valueOffset;
    expect(updates.map((update) => update.slot)).toEqual([0, 4, 2, 1, 3]);
    expect(updates[2]).toEqual({
      slot: 2,
      extent: [0, 2, 0, 1, 2, 2],
      range: [
        [Math.min(...words.slice(12, 18)), Math.max(...words.slice(12, 18))],
      ],
    });
    expect(ranges).toEqual([
      undefined,
      ...[0, 4, 2, 1, 3].map((frame) => ({
        start: start + frame * 12,
        end: start + (frame + 1) * 12,
      })),
    ]);
    expect(Array.from(volume.data)).toEqual(words);
  });

  it('loads the frames a file cut short still holds and fails the rest', async () => {
    const { bytes, words } = multiframe();
    const instance = await readInstance(blobOf(bytes), signal());
    const cut = { ...instance, source: blobOf(bytes.subarray(0, -18)) };

    const { volume, updates } = await load([cut], { readConcurrency: 1 });

    const failed = updates.flatMap((update) =>
      'error' in update ? [[update.slot, update.error.message]] : []
    );
    expect(failed).toEqual([
      [
        4,
        expect.stringMatching(
          /frame 4 could not be decoded: A frame needs 12 bytes of Pixel Data; 0 were read$/
        ),
      ],
      [
        3,
        expect.stringMatching(
          /frame 3 could not be decoded: A frame needs 12 bytes of Pixel Data; 6 were read$/
        ),
      ],
    ]);
    expect(Array.from(volume.loaded)).toEqual([1, 1, 1, 0, 0]);
    expect(Array.from(volume.data.subarray(0, 18))).toEqual(words.slice(0, 18));
  });

  it('reads only the frame that failed when the volume loads again', async () => {
    const { bytes, words } = multiframe();
    const blob = blobOf(bytes);
    const instance = await readInstance(blob, signal());
    const lost = instance.pixelData!.valueOffset + 2 * 12;
    let dropped = false;
    const { source, ranges } = recorded({
      ...blob,
      read: (readSignal, range) => {
        if (range?.start !== lost || dropped)
          return blob.read(readSignal, range);
        dropped = true;
        return new ReadableStream({
          start: (controller) => controller.error(new Error('dropped')),
        });
      },
    });
    const volume = allocated([{ ...instance, source }]);
    const loadAgain = async () => {
      const updates: VolumeUpdate[] = [];
      for await (const update of loadVolume(volume, {
        runtime: nativeOnly(),
        signal: signal(),
      }))
        updates.push(update);
      return updates;
    };

    const first = await loadAgain();
    ranges.length = 0;
    const second = await loadAgain();

    expect(first.filter((update) => 'error' in update)).toHaveLength(1);
    expect(second.map((update) => update.slot)).toEqual([2]);
    expect(ranges).toEqual([{ start: lost, end: lost + 12 }]);
    expect(Array.from(volume.data)).toEqual(words);
  });

  it('reports the float32-rounded range a Float32 volume stores', async () => {
    const { bytes, words } = multiframe({ rescale: [0.1, 0.3] });
    const instance = await readInstance(blobOf(bytes), signal());

    const { volume, updates } = await load([instance]);

    const frame = words.slice(0, 6).map((stored) => stored * 0.1 + 0.3);
    expect(volume.data).toBeInstanceOf(Float32Array);
    expect(updates.find(({ slot }) => slot === 0)).toMatchObject({
      range: [
        [Math.fround(Math.min(...frame)), Math.fround(Math.max(...frame))],
      ],
    });
    expect(Array.from(volume.data.subarray(0, 6))).toEqual(
      frame.map(Math.fround)
    );
  });

  it('reads a single-frame file from its Pixel Data value onwards', async () => {
    const files = [1, 2, 3].map((instance) =>
      nativePixelDicom({
        instance,
        position: [0, 0, instance],
        rescale: [1, -1000],
        bitsStored: 12,
      })
    );
    const sources = files.map((bytes) => recorded(blobOf(bytes)));
    const members = await Promise.all(
      sources.map(({ source }) => readInstance(source, signal()))
    );

    const { volume, updates } = await load(members, { readConcurrency: 1 });

    expect(updates.map((update) => update.slot)).toEqual([1, 0, 2]);
    sources.forEach(({ ranges }, index) =>
      expect(ranges[1]).toEqual({
        start: members[index].pixelData!.valueOffset,
        end: members[index].pixelData!.valueOffset + 30,
      })
    );
    expect(volume.loaded).toEqual(new Uint8Array([1, 1, 1]));
    expect(volume.data).toBeInstanceOf(Int16Array);
  });

  it.each([
    ['honours', 1 + FRAMES],
    ['ignores', 3],
  ] as const)(
    'probes a server that %s Range with one frame, then makes %i requests in all',
    async (behaviour, requests) => {
      const { bytes, words } = multiframe();
      const asked: Array<string | null> = [];
      const fetchFn: typeof fetch = async (_url, init) => {
        const range = new Headers(init?.headers).get('Range');
        asked.push(range);
        const [, from, to] = /bytes=(\d+)-(\d+)/.exec(range ?? '') ?? [];
        return behaviour === 'honours' && from
          ? new Response(bytes.slice(Number(from), Number(to) + 1), {
              status: 206,
            })
          : new Response(bytes.slice());
      };
      const instance = await readInstance(
        fromUrl('https://example.test/frames.dcm', { fetch: fetchFn }),
        signal()
      );

      const { volume } = await load([instance]);

      const start = instance.pixelData!.valueOffset;
      const frames = (index: number, count = 1) =>
        `bytes=${start + index * 12}-${start + (index + count) * 12 - 1}`;
      const [header, probe, ...rest] = asked;
      expect(header).toBeNull();
      expect(probe).toBe(frames(0));
      expect(rest).toHaveLength(requests - 2);
      expect(rest).toEqual(
        behaviour === 'honours'
          ? expect.arrayContaining([1, 2, 3, 4].map((index) => frames(index)))
          : [frames(1, FRAMES - 1)]
      );
      expect(Array.from(volume.data)).toEqual(words);
    }
  );

  it('fails every slice of an instance it cannot decode, without reading pixels', async () => {
    const { bytes } = multiframe({
      transferSyntaxUid: '1.2.840.10008.1.2.4.102',
    });
    const { source, ranges } = recorded(blobOf(bytes));
    const instance = await readInstance(source, signal());

    const { updates } = await load([instance]);

    expect(updates).toEqual(failsWhole(/MPEG-4 .* has no decoder/));
    expect(ranges).toEqual([undefined]);
  });

  it('hands a declined instance to the whole-instance decoder', async () => {
    const { bytes } = multiframe({ photometric: 'PALETTE COLOR' });
    const instance = await readInstance(blobOf(bytes), signal());

    const { updates } = await load([instance]);

    expect(updates).toEqual(
      failsWhole(
        /^File .* \(member 0\) could not be decoded: GDCM decoding needs createDicomRuntime\(\{ assets \}\)$/
      )
    );
  });

  it('loads frame by frame through a per-frame decoder added to the table', async () => {
    const codec = '1.2.3.4';
    const { bytes, words } = multiframe({ transferSyntaxUid: codec });
    const { source, ranges } = recorded(blobOf(bytes));
    const instance = await readInstance(source, signal());
    const runtime = runtimeFor(codec, {
      name: 'Per-frame codec',
      plan: ({ pixelData }) =>
        Array.from({ length: FRAMES }, (_, frame) =>
          frameUnit(pixelData!.valueOffset, frame)
        ),
    });

    const { volume, updates } = await load([instance], {
      readConcurrency: 1,
      runtime,
    });

    const start = instance.pixelData!.valueOffset;
    expect(updates.map((update) => update.slot)).toEqual([0, 4, 2, 1, 3]);
    expect(ranges.slice(1)).toEqual(
      [0, 4, 2, 1, 3].map((frame) => ({
        start: start + frame * 12,
        end: start + (frame + 1) * 12,
      }))
    );
    expect(Array.from(volume.data)).toEqual(words);
  });
});
