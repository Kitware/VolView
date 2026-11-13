import { describe, expect, it } from 'vitest';
import {
  createDicomRuntime,
  defaultDecodeConcurrency,
} from '../createDicomRuntime';
import { createGdcmDecoder, type GdcmLane } from '../gdcmDecoder';
import { defer } from '../../utils';
import { getDatasetTag } from '../../metadata/datasetAccess';
import { fromBlob } from '../../source/byteSource';
import { instanceFor } from '@/tests/dicomDataset';
import { sliceDataset } from '../../collections/__tests__/sliceFixture';
import type { DecodedPixels, DecodeUnit } from '../../pixels/pixelDecoder';
import { syntheticSlice } from '@/tests/dicomSourceFixtures';

const assets = {
  pipelineWorkerUrl: '/unused-worker.js',
  imageIOUrl: '/unused-image-io',
};
const decodedPixels: DecodedPixels = {
  size: [1, 1, 1],
  data: new Uint16Array(1),
  components: 1,
};
const signal = () => new AbortController().signal;

/** Lanes whose runs settle when the test says, rejecting on reset like a worker. */
function controlledLanes() {
  let active = 0;
  let peak = 0;
  const gate = defer<void>();
  const runs: Array<() => void> = [];
  const resets: unknown[] = [];
  const createLane = (): GdcmLane => {
    let rejectRun: ((reason: unknown) => void) | undefined;
    return {
      run: () =>
        new Promise((resolve, reject) => {
          active += 1;
          peak = Math.max(peak, active);
          rejectRun = reject;
          runs.forEach((started) => started());
          gate.promise.then(() => {
            active -= 1;
            resolve(decodedPixels);
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

const decodeWith = (
  gdcm: ReturnType<typeof createGdcmDecoder>,
  abort = signal()
) => {
  const instance = instanceFor(sliceDataset());
  const [unit] = gdcm.decoder.plan(instance, Uint16Array) as DecodeUnit[];
  return Promise.resolve(unit.decode(new Uint8Array(1), abort));
};

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

  it('runs at most its concurrency of GDCM decodes at once', async () => {
    const lanes = controlledLanes();
    const gdcm = createGdcmDecoder(assets, 2, lanes.createLane);

    const decodes = [0, 1, 2].map(() => decodeWith(gdcm));
    await lanes.started(2);
    lanes.gate.resolve();
    await Promise.all(decodes);

    expect(lanes.peak()).toBe(2);
    gdcm.dispose(new Error('done'));
  });

  it('settles running and queued GDCM decodes when disposed', async () => {
    const lanes = controlledLanes();
    const gdcm = createGdcmDecoder(assets, 1, lanes.createLane);

    const running = decodeWith(gdcm);
    const queued = decodeWith(gdcm);
    const reason = new DOMException('disposed', 'AbortError');
    gdcm.dispose(reason);

    await expect(running).rejects.toBe(reason);
    await expect(queued).rejects.toBe(reason);
  });

  it('terminates the GDCM worker of a decode whose signal aborts', async () => {
    const lanes = controlledLanes();
    const gdcm = createGdcmDecoder(assets, 1, lanes.createLane);
    const controller = new AbortController();

    const decoding = decodeWith(gdcm, controller.signal);
    await lanes.started(1);
    const reason = new DOMException('stop', 'AbortError');
    controller.abort(reason);

    await expect(decoding).rejects.toBe(reason);
    expect(lanes.resets).toEqual([reason]);
    gdcm.dispose(reason);
  });

  it('reads instances with its own metadata reader, needing no decoder assets', async () => {
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

  it('fails a GDCM decode without assets', async () => {
    const gdcm = createGdcmDecoder(undefined, 1);

    await expect(decodeWith(gdcm)).rejects.toThrow(
      'GDCM decoding needs createDicomRuntime({ assets })'
    );
  });
});
