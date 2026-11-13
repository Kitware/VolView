import { readBytes } from '@volview/dicom/core/source/byteSource';
import type { Instance } from '@volview/dicom/core/instance/readInstance';
import {
  defaultDecoderTable,
  planDecode,
  type DecodePlan,
} from '@volview/dicom/core/pixels/decoderTable';
import {
  getVolumeBufferType,
  instancePixelFormats,
  type VolumeBufferConstructor,
} from '@volview/dicom/core/volume/pixelFormat';
import { createRuntime, failed, never, report, sourceOf } from './shared';

// Decodes each listed instance through GDCM and, where the decoder table
// plans native frames, frame by frame from ranged reads, then reports the
// first sample where what each path writes into the volume differs. Integer
// GDCM output must also equal the native samples before any conversion.

const runtime = createRuntime();

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
  plan: Extract<DecodePlan, { kind: 'frames' }>,
  Target: VolumeBufferConstructor
) {
  const frames = await Promise.all(
    plan.index.frames.map(
      async (range) =>
        plan.decode(
          await readBytes(instance.source, never, range),
          plan.format,
          Target
        ).samples
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
  const plan = planDecode(defaultDecoderTable, instance);
  if (plan.kind !== 'frames')
    return {
      name,
      plan: plan.kind,
      reason: plan.kind === 'unsupported' ? plan.error.message : plan.reason,
    };
  const gdcm = await runtime.decode(
    { instance, bytes: await readBytes(instance.source, never) },
    never
  );
  const Target = getVolumeBufferType(instancePixelFormats(instance.dataset));
  const native = await decodeFrames(instance, plan, Target);
  return {
    name,
    plan: plan.kind,
    volume: Target.name,
    gdcm: gdcm.data.constructor.name,
    native: native.constructor.name,
    samples: native.length,
    mismatch: firstMismatch(new Target(gdcm.data), native),
    rawMismatch: isFloat(gdcm.data) ? null : firstMismatch(gdcm.data, native),
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
