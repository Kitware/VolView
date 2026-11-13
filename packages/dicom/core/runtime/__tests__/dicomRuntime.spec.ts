import { describe, expect, it } from 'vitest';
import {
  createDicomRuntime,
  defaultDecodeConcurrency,
  type PixelDecoder,
} from '../createDicomRuntime';
import { defer } from '../../utils';
import { getDatasetTag } from '../../metadata/datasetAccess';
import { fromBlob } from '../../source/byteSource';
import { instanceFor } from '../../instance/__tests__/instanceFixture';
import { sliceDataset } from '../../collections/__tests__/sliceFixture';
import { syntheticSlice } from '@/tests/dicomSourceFixtures';

const request = () => ({
  instance: instanceFor(sliceDataset()),
  bytes: new Uint8Array(1),
});
const decodedImage = {
  size: [1, 1, 1],
  data: new Uint16Array(1),
  imageType: { components: 1 },
};
const signal = () => new AbortController().signal;

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

  it('runs at most decodeConcurrency decodes at once', async () => {
    let active = 0;
    let peak = 0;
    const gate = defer<void>();
    const twoStarted = defer<void>();
    const decoder: PixelDecoder = async () => {
      active += 1;
      peak = Math.max(peak, active);
      if (active === 2) twoStarted.resolve();
      await gate.promise;
      active -= 1;
      return decodedImage;
    };
    const runtime = createDicomRuntime({ decoder, decodeConcurrency: 2 });

    const decodes = [0, 1, 2].map(() => runtime.decode(request(), signal()));
    await twoStarted.promise;
    gate.resolve();
    await Promise.all(decodes);

    expect(peak).toBe(2);
    runtime.dispose();
  });

  it('settles running and queued work when disposed', async () => {
    const decoder: PixelDecoder = () => new Promise(() => {});
    const runtime = createDicomRuntime({ decoder, decodeConcurrency: 1 });

    const running = runtime.decode(request(), signal());
    const queued = runtime.decode(request(), signal());
    runtime.dispose();

    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      runtime.readInstance(fromBlob(new Blob([])), signal())
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('settles a decode whose signal aborts', async () => {
    const runtime = createDicomRuntime({
      decoder: () => new Promise(() => {}),
    });
    const controller = new AbortController();

    const decoding = runtime.decode(request(), controller.signal);
    controller.abort(new DOMException('stop', 'AbortError'));

    await expect(decoding).rejects.toMatchObject({ name: 'AbortError' });
    runtime.dispose();
  });

  it('reads instances with its own metadata reader', async () => {
    const runtime = createDicomRuntime();
    const bytes = syntheticSlice({ patientName: 'DOE^JOHN' });

    const instance = await runtime.readInstance(
      fromBlob(new Blob([bytes as BlobPart])),
      signal()
    );

    expect(getDatasetTag(instance.dataset, '00100010')).toBe('DOE^JOHN');
    await expect(runtime.decode(request(), signal())).rejects.toThrow(
      'Provide DICOM decoder assets or a decoder'
    );
    runtime.dispose();
  });
});
