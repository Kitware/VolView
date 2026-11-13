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
  type RangeSupport,
} from '../../source/byteSource';
import { loadVolume, type VolumeUpdate } from '../loadVolume';
import { defaultDecoderTable } from '../../pixels/decoderTable';
import type { DecodeUnit, PixelDecoder } from '../../pixels/pixelDecoder';
import { allocated } from './volumeFixture';
import { hangingSource } from '@/tests/byteSourceFixtures';
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
    readAhead?: number;
    abort?: AbortSignal;
    runtime?: DicomRuntime;
  } = {}
) => {
  const volume = allocated(members);
  const updates: VolumeUpdate[] = [];
  for await (const update of loadVolume(volume, {
    runtime: options.runtime ?? nativeOnly(),
    signal: options.abort ?? signal(),
    readAhead: options.readAhead,
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
    decoders: (gdcm) => {
      const table = defaultDecoderTable(gdcm);
      return {
        ...table,
        byTransferSyntax: new Map([
          ...table.byTransferSyntax,
          [codec, [decoder, gdcm]],
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

    const { volume, updates } = await load([instance], { readAhead: 1 });

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

    const { volume, updates } = await load(members);

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
    [true, 1 + FRAMES],
    [false, 3],
  ])(
    'reads frames from a server that honours Range (%s) in %i requests',
    async (honoured, requests) => {
      const { bytes, words } = multiframe();
      const asked: Array<string | null> = [];
      const fetchFn: typeof fetch = async (_url, init) => {
        const range = new Headers(init?.headers).get('Range');
        asked.push(range);
        const [, from, to] = /bytes=(\d+)-(\d+)/.exec(range ?? '') ?? [];
        return honoured && from
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

      expect(asked).toHaveLength(requests);
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

    expect(updates).toEqual([
      {
        slot: 0,
        extent: [0, 2, 0, 1, 0, FRAMES - 1],
        error: expect.objectContaining({
          message: expect.stringMatching(/MPEG-4 .* has no decoder/),
        }),
      },
    ]);
    expect(ranges).toEqual([undefined]);
  });

  it('hands a declined instance to the whole-instance decoder', async () => {
    const { bytes } = multiframe({ photometric: 'MONOCHROME1' });
    const instance = await readInstance(blobOf(bytes), signal());

    const { updates } = await load([instance]);

    expect(updates).toEqual([
      {
        slot: 0,
        extent: [0, 2, 0, 1, 0, FRAMES - 1],
        error: new Error('GDCM decoding needs createDicomRuntime({ assets })'),
      },
    ]);
  });

  it('stops frame reads and yields nothing once aborted', async () => {
    const { bytes } = multiframe();
    const hanging = hangingSource();
    const blob = blobOf(bytes);
    const source: ByteSource = {
      read: (readSignal, range) =>
        range ? hanging.source.read(readSignal, range) : blob.read(readSignal),
    };
    const instance = await readInstance(source, signal());
    const controller = new AbortController();

    const loading = load([instance], { abort: controller.signal });
    await hanging.pulled;
    const reason = new DOMException('closed', 'AbortError');
    controller.abort(reason);

    expect((await loading).updates).toEqual([]);
    expect(await hanging.cancelled).toBe(reason);
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
      readAhead: 1,
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

  it.each([
    ['no units', () => []],
    [
      'overlapping units',
      (offset: number) =>
        [0, 1, 2, 2, 3, 4].map((frame) => frameUnit(offset, frame)),
    ],
    [
      'units that skip a frame',
      (offset: number) => [0, 1, 3, 4].map((frame) => frameUnit(offset, frame)),
    ],
    [
      'a unit past the last frame',
      (offset: number) =>
        [1, 2, 3, 4, 5].map((frame) => frameUnit(offset, frame)),
    ],
  ])(
    'fails every slice of an instance whose decoder plans %s',
    async (_, units: (offset: number) => DecodeUnit[]) => {
      const codec = '1.2.3.4';
      const { bytes } = multiframe({ transferSyntaxUid: codec });
      const { source, ranges } = recorded(blobOf(bytes));
      const instance = await readInstance(source, signal());
      const runtime = runtimeFor(codec, {
        name: 'Partial codec',
        plan: ({ pixelData }) => units(pixelData!.valueOffset),
      });

      const { volume, updates } = await load([instance], { runtime });

      expect(updates).toEqual([
        {
          slot: 0,
          extent: [0, 2, 0, 1, 0, FRAMES - 1],
          error: expect.objectContaining({
            message: expect.stringMatching(
              /^Partial codec planned units that do not cover frames 0 to 4 of File .* exactly once$/
            ),
          }),
        },
      ]);
      expect(ranges).toEqual([undefined]);
      expect(volume.loaded).toEqual(new Uint8Array(FRAMES));
    }
  );

  it.each([
    ['honours', FRAMES],
    ['ignores', 2],
  ] as const)(
    'probes a source that %s Range with one frame, then makes %i frame reads in all',
    async (behaviour, frameReads) => {
      const { bytes, words } = multiframe();
      const blob = recorded(blobOf(bytes));
      let support: RangeSupport = 'unknown';
      const source: ByteSource = {
        read: (readSignal, range) => {
          if (range) support = behaviour === 'honours' ? 'honoured' : 'ignored';
          return blob.source.read(readSignal, range);
        },
        rangeSupport: () => support,
      };
      const instance = await readInstance(source, signal());

      const { volume } = await load([instance]);

      const start = instance.pixelData!.valueOffset;
      const frame = (index: number, count = 1) => ({
        start: start + index * 12,
        end: start + (index + count) * 12,
      });
      const [header, probe, ...rest] = blob.ranges;
      expect(header).toBeUndefined();
      expect(probe).toEqual(frame(0));
      expect(rest).toHaveLength(frameReads - 1);
      expect(rest).toEqual(
        behaviour === 'honours'
          ? expect.arrayContaining([1, 2, 3, 4].map((index) => frame(index)))
          : [frame(1, FRAMES - 1)]
      );
      expect(Array.from(volume.data)).toEqual(words);
    }
  );

  it('reads frame calibrations in time linear in the frame count', async () => {
    const datasetReads = async (frames: number) => {
      const bytes = nativePixelDicom({
        rows: 2,
        columns: 3,
        frames,
        words: patternWords(frames * 6, 16),
        rescale: [0.1, 0.3],
      });
      const instance = await readInstance(blobOf(bytes), signal());
      const { dataset } = instance;
      let reads = 0;
      const counted = {
        ...instance,
        dataset: {
          ...dataset,
          get elements() {
            reads += 1;
            return dataset.elements;
          },
        },
      };
      const { volume, updates } = await load([counted]);
      expect(volume.data).toBeInstanceOf(Float32Array);
      expect(updates).toHaveLength(frames);
      return reads;
    };

    const [ten, twenty, forty] = [
      await datasetReads(10),
      await datasetReads(20),
      await datasetReads(40),
    ];

    expect(forty - twenty).toBe(2 * (twenty - ten));
  });
});
