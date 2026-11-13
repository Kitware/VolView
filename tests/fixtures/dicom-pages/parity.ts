import {
  getVolumeBufferType,
  instancePixelFormats,
  nativeFrameDecoder,
  planDecode,
  readBytes,
  type DecodeUnit,
  type Instance,
  type VolumeBufferConstructor,
} from '@/packages/dicom/core';
import {
  createRuntime,
  failed,
  firstUnit,
  gdcmOnly,
  never,
  report,
  sourceOf,
} from './shared';

// Decodes each listed instance through GDCM and, where the decoder table
// plans native frames, frame by frame from ranged reads, then reports the
// first sample where what each path writes into the volume differs. Integer
// GDCM output must also equal the native samples before any conversion.

const runtime = createRuntime();
const gdcm = createRuntime(gdcmOnly);

const firstMismatch = (
  expected: ArrayLike<number>,
  actual: ArrayLike<number>
) => {
  if (expected.length !== actual.length)
    return `length ${expected.length} vs ${actual.length}`;
  for (let index = 0; index < expected.length; index += 1)
    if (!Object.is(expected[index], actual[index]))
      return `sample ${index}: GDCM ${expected[index]}, native ${actual[index]}`;
  return null;
};

const isFloat = (data: ArrayLike<number>) =>
  data instanceof Float32Array || data instanceof Float64Array;

async function decodeFrames(
  instance: Instance,
  units: DecodeUnit[],
  Target: VolumeBufferConstructor
) {
  const frames = await Promise.all(
    units.map(
      async (unit) =>
        (
          await unit.decode(
            await readBytes(instance.source, never, unit.range ?? undefined),
            never
          )
        ).data
    )
  );
  const samples = new Target(frames.reduce((n, frame) => n + frame.length, 0));
  frames.reduce((offset, frame) => {
    samples.set(frame, offset);
    return offset + frame.length;
  }, 0);
  return samples;
}

async function compare(name: string, source: string) {
  const url = new URL(
    `./corpus-data/${encodeURIComponent(name)}`,
    document.baseURI
  );
  const input =
    source === 'file' ? new File([await (await fetch(url)).blob()], name) : url;
  const instance = await runtime.readInstance(sourceOf(input), never);
  const planned = planDecode(runtime.decoders, instance, Float64Array);
  if ('error' in planned)
    return { name, plan: 'unsupported', reason: planned.error.message };
  if (planned.decoder !== nativeFrameDecoder)
    return { name, plan: planned.decoder.name };
  const Target = getVolumeBufferType(instancePixelFormats(instance.dataset));
  const units = nativeFrameDecoder.plan(instance, Target) as DecodeUnit[];
  const decoded = await firstUnit(gdcm, instance).decode(
    await readBytes(instance.source, never),
    never
  );
  const native = await decodeFrames(instance, units, Target);
  return {
    name,
    plan: 'frames',
    volume: Target.name,
    gdcm: decoded.data.constructor.name,
    native: native.constructor.name,
    samples: native.length,
    mismatch: firstMismatch(new Target(decoded.data), native),
    rawMismatch: isFloat(decoded.data)
      ? null
      : firstMismatch(decoded.data, native),
  };
}

async function run() {
  const params = new URL(location.href).searchParams;
  const source = params.get('source') ?? 'http';
  const listed: string[] = await (
    await fetch(new URL('./corpus-data/parity-cases.json', document.baseURI))
  ).json();
  const names = listed.slice(
    Number(params.get('from') ?? 0),
    Number(params.get('to') ?? listed.length)
  );
  const results = [];
  for (const name of names)
    results.push(
      await compare(name, source).catch((error: Error) => ({
        name,
        error: error.message,
      }))
    );
  report('report', JSON.stringify(results));
  report('status', 'complete');
}

run().catch(failed);
