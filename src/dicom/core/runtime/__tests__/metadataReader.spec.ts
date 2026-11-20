import { describe, expect, it } from 'vitest';
import * as Comlink from 'comlink';
import {
  readDicomDataset,
  readPublicDataset,
} from '../../metadata/dicomDataset';
import { createMetadataReader } from '../metadataReader';
import { buildSlice } from '@/tests/specs/dicomElementFixtures';
import { rawElement } from '@/tests/specs/syntheticDicom';

const readDicomDatasetOffThread = createMetadataReader().read;

// The test DOM has no Worker, so this covers the in-place path only; the
// worker path is the same reader behind a message.
describe('readDicomDatasetOffThread', () => {
  it('reads what the reader reads', async () => {
    const bytes = buildSlice({ patientName: 'DOE^JOHN' });

    expect(await readDicomDatasetOffThread(bytes)).toEqual(
      readDicomDataset(bytes)
    );
  });

  it('returns no private element, so none crosses to the caller', async () => {
    const bytes = buildSlice({
      extraElements: [
        rawElement(0x0029, 0x0010, 'LO', new TextEncoder().encode('VENDOR')),
        rawElement(0x0029, 0x1010, 'OB', new Uint8Array(64)),
      ],
    });

    expect(await readDicomDatasetOffThread(bytes)).toEqual(
      readDicomDataset(buildSlice())
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
    const reader = createMetadataReader(() => {
      const worker = new MetadataWorker();
      workers.push(worker);
      return worker as unknown as Worker;
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

  it('transfers a copy, so the caller keeps its bytes', async () => {
    const reader = createMetadataReader(() => {
      const { port1, port2 } = new MessageChannel();
      Comlink.expose({ readPublicDataset }, port2);
      return Object.assign(port1, {
        terminate: () => port2.close(),
      }) as unknown as Worker;
    });
    const bytes = buildSlice();
    const original = bytes.slice();

    const dataset = await reader.read(bytes);
    reader.dispose();

    expect(bytes).toEqual(original);
    expect(dataset).toEqual(readPublicDataset(original));
  });
});
