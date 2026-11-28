import { describe, expect, it } from 'vitest';
import {
  createDicomRuntime,
  defaultDecodeConcurrency,
} from '../createDicomRuntime';
import { createCodecDecoders, type CodecLane } from '../codecDecoder';
import { getDatasetTag } from '../../metadata/datasetAccess';
import { fromBlob } from '../../source/byteSource';
import { pixelInstance } from '../../pixels/__tests__/pixelFixture';
import { syntheticSlice } from '@/tests/dicomSourceFixtures';

const signal = () => new AbortController().signal;

/** Lanes whose runs settle when the test says, rejecting on reset like a worker. */
function controlledLanes() {
  let active = 0;
  let peak = 0;
  const gate = Promise.withResolvers<void>();
  const runs: Array<() => void> = [];
  const resets: unknown[] = [];
  const createLane = (): CodecLane => {
    let rejectRun: ((reason: unknown) => void) | undefined;
    return {
      run: ({ shape }) =>
        new Promise((resolve, reject) => {
          active += 1;
          peak = Math.max(peak, active);
          rejectRun = reject;
          runs.forEach((started) => started());
          gate.promise.then(() => {
            active -= 1;
            resolve({ ...shape, precision: 16, bytes: new Uint8Array(2) });
          });
        }),
      reset: (reason) => {
        resets.push(reason);
        rejectRun?.(reason);
      },
    };
  };
  const started = (count: number) =>
    new Promise<void>((resolve) => {
      const check = () => active >= count && resolve();
      runs.push(check);
      check();
    });
  return { createLane, gate, started, resets, peak: () => peak };
}

/** A function that starts one decode on `codecs` each time it is called. */
async function decodeOn(codecs: ReturnType<typeof createCodecDecoders>) {
  const { instance } = await pixelInstance({ rows: 1, columns: 1 });
  const units = codecs.decoders.rle.plan(instance, Uint16Array);
  if ('declined' in units) throw new Error(units.declined);
  return async (abort = signal()) => units[0].decode(new Uint8Array(1), abort);
}

describe('DICOM runtime', () => {
  it.each([
    [undefined, 1],
    [1, 1],
    [6, 3],
    [32, 4],
  ])(
    'defaults to bounded decode concurrency for %s cores',
    (cores, expected) => {
      expect(defaultDecodeConcurrency(cores)).toBe(expected);
    }
  );

  it('runs at most its concurrency of codec decodes at once', async () => {
    const lanes = controlledLanes();
    const codecs = createCodecDecoders(2, lanes.createLane);

    const decode = await decodeOn(codecs);

    const decodes = [0, 1, 2].map(() => decode());
    await lanes.started(2);
    lanes.gate.resolve();
    await Promise.all(decodes);

    expect(lanes.peak()).toBe(2);
    codecs.dispose(new Error('done'));
  });

  it('settles running and queued codec decodes when disposed', async () => {
    const lanes = controlledLanes();
    const codecs = createCodecDecoders(1, lanes.createLane);

    const decode = await decodeOn(codecs);

    const running = decode();
    const queued = decode();
    await lanes.started(1);
    const reason = new DOMException('disposed', 'AbortError');
    codecs.dispose(reason);

    await expect(running).rejects.toBe(reason);
    await expect(queued).rejects.toBe(reason);
    expect(lanes.peak()).toBe(1);
    expect(lanes.resets).toContain(reason);
  });

  it('terminates idle codec workers when disposed', async () => {
    const lanes = controlledLanes();
    const codecs = createCodecDecoders(1, lanes.createLane);
    lanes.gate.resolve();
    await (
      await decodeOn(codecs)
    )();

    const reason = new DOMException('disposed', 'AbortError');
    codecs.dispose(reason);

    expect(lanes.resets).toEqual([reason]);
  });

  it('terminates the codec worker of a decode whose signal aborts', async () => {
    const lanes = controlledLanes();
    const codecs = createCodecDecoders(1, lanes.createLane);
    const controller = new AbortController();
    const decode = await decodeOn(codecs);

    const decoding = decode(controller.signal);
    await lanes.started(1);
    const reason = new DOMException('stop', 'AbortError');
    controller.abort(reason);

    await expect(decoding).rejects.toBe(reason);
    expect(lanes.resets).toEqual([reason]);
    codecs.dispose(reason);
  });

  it('reads instances with its own metadata reader until disposed', async () => {
    const runtime = createDicomRuntime();
    const bytes = syntheticSlice({ patientName: 'DOE^JOHN' });

    const instance = await runtime.readInstance(
      fromBlob(new Blob([bytes as BlobPart])),
      signal()
    );

    expect(getDatasetTag(instance.dataset, '00100010')).toBe('DOE^JOHN');
    runtime.dispose();
    await expect(
      runtime.readInstance(fromBlob(new Blob([])), signal())
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
