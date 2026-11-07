import { describe, expect, it } from 'vitest';
import { readDicomDataset } from '../dicomDataset';
import { createMetadataReader } from '../../runtime/metadataReader';
const readDicomDatasetOffThread = createMetadataReader().read;
import { buildSlice } from '@/src/io/__tests__/readDicomTagsFixtures';

// The test DOM has no Worker, so this covers the in-place path only; the
// worker path is the same reader behind a message.
describe('readDicomDatasetOffThread', () => {
  it('reads what the reader reads', async () => {
    const bytes = buildSlice({ patientName: 'DOE^JOHN' });

    expect(await readDicomDatasetOffThread(bytes)).toEqual(
      readDicomDataset(bytes)
    );
  });

  it('reads a view that does not own its buffer', async () => {
    const whole = buildSlice();
    const padded = new Uint8Array(whole.length + 3);
    padded.set(whole, 3);

    expect(await readDicomDatasetOffThread(padded.subarray(3))).toEqual(
      readDicomDataset(whole)
    );
  });

  it('rejects what the reader rejects', async () => {
    await expect(
      readDicomDatasetOffThread(new Uint8Array(256).fill(0x41))
    ).rejects.toThrow(/Not DICOM/);
  });
});

class MetadataWorker extends EventTarget {
  terminated = false;
  postMessage() {}
  terminate() {
    this.terminated = true;
  }
}

describe('metadata worker ownership', () => {
  it('settles worker failure, allows retry, and terminates pending work on disposal', async () => {
    const workers: MetadataWorker[] = [];
    const reader = createMetadataReader({
      metadataWorkerFactory: () => {
        const worker = new MetadataWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      },
    });
    const first = reader.read(buildSlice());
    const failure = expect(first).rejects.toThrow('worker failed');
    workers[0].dispatchEvent(new Event('error'));
    await failure;
    expect(workers[0].terminated).toBe(true);
    const retry = reader.read(buildSlice());
    const stopped = expect(retry).rejects.toMatchObject({ name: 'AbortError' });
    reader.dispose();
    await stopped;
    expect(workers[1].terminated).toBe(true);
    await expect(reader.read(buildSlice())).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
