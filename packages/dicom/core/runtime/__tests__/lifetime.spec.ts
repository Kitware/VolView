import { describe, it, expect } from 'vitest';
import { createDicomLoader } from '../createDicomLoader';
import { Chunk } from '../../streaming/chunk';
import { DicomMetaLoader } from '../../streaming/dicom/dicomMetaLoader';
import { DicomDataLoader } from '../../streaming/dicom/dicomDataLoader';
import { blobFetcher } from '../../streaming/blobFetcher';
import { RequestPool } from '../../streaming/requestPool';
import { readDicomDataset } from '../../metadata/dicomDataset';
import { getDatasetTag } from '../../metadata/datasetAccess';
import { defer } from '../../utils';
import { syntheticSlice } from '@/tests/dicomSourceFixtures';

const blob = () =>
  new Blob([new Uint8Array(syntheticSlice({ patientName: 'DOE^JOHN' }))]);

describe('DICOM instance lifetimes', () => {
  it('settles cancellation and lets retry finish before a stale header read', async () => {
    const first = defer<ReturnType<typeof readDicomDataset>>();
    const started = defer<void>();
    const source = blobFetcher(blob());
    let reads = 0;
    const metadata = new DicomMetaLoader(source, (bytes) => {
      if (reads++ === 0) {
        started.resolve();
        return first.promise;
      }
      return readDicomDataset(bytes);
    });
    const chunk = new Chunk({
      metaLoader: metadata,
      dataLoader: new DicomDataLoader(source),
    });
    const cancelledRead = chunk.loadMeta();
    await started.promise;
    const rejected = expect(cancelledRead).rejects.toMatchObject({
      name: 'AbortError',
    });
    chunk.stopLoad();
    await chunk.loadMeta();
    await rejected;
    first.resolve(
      readDicomDataset(syntheticSlice({ patientName: 'STALE^NAME' }))
    );
    await first.promise;
    expect(getDatasetTag(chunk.metadata, '00100010')).toBe('DOE^JOHN');
    await chunk.loadData();
    expect(await chunk.dataBlob!.arrayBuffer()).toEqual(
      await blob().arrayBuffer()
    );
    chunk.dispose();
    await expect(chunk.loadMeta()).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('retries a failed HTTP source without creating a second instance', async () => {
    let requests = 0;
    const loader = createDicomLoader({
      fetch: async () => {
        if (requests++ === 0) throw new Error('offline');
        return new Response(blob());
      },
    });
    const chunk = loader.createChunk('https://example.test/slice.dcm');
    await expect(chunk.loadMeta()).rejects.toThrow('offline');
    await chunk.loadMeta();
    expect(getDatasetTag(chunk.metadata, '00100010')).toBe('DOE^JOHN');
    await chunk.loadData();
    expect(chunk.dataBlob?.size).toBe(blob().size);
    loader.release(chunk);
    expect(chunk.dataBlob).toBeUndefined();
    await expect(chunk.loadData()).rejects.toMatchObject({
      name: 'AbortError',
    });
    loader.dispose();
  });

  it('settles an injected pending decode when its loader is disposed', async () => {
    const result = defer<{
      image: {
        size: number[];
        data: Uint16Array;
        imageType: { components: number };
      };
    }>();
    const started = defer<void>();
    const loader = createDicomLoader({
      decoder: () => {
        started.resolve();
        return result.promise;
      },
    });
    const decode = loader.readDicomImage(new File([blob()], 'slice.dcm'));
    const rejected = expect(decode).rejects.toMatchObject({
      name: 'AbortError',
    });
    await started.promise;
    loader.dispose();
    await rejected;
    result.resolve({
      image: {
        size: [1, 1],
        data: new Uint16Array([17]),
        imageType: { components: 1 },
      },
    });
    await expect(
      loader.readDicomImage(new File([], 'slice.dcm'))
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('settles queued requests immediately on cancellation or disposal', async () => {
    const fetchStarted = defer<void>();
    const pool = new RequestPool(
      1,
      (_request, init) =>
        new Promise((_resolve, reject) => {
          fetchStarted.resolve();
          init?.signal?.addEventListener(
            'abort',
            () => reject(init.signal?.reason),
            { once: true }
          );
        })
    );
    const first = pool.fetch('https://example.test/first');
    const firstRejected = expect(first).rejects.toMatchObject({
      name: 'AbortError',
    });
    await fetchStarted.promise;
    const cancellation = new AbortController();
    const second = pool.fetch('https://example.test/second', {
      signal: cancellation.signal,
    });
    const secondRejected = expect(second).rejects.toMatchObject({
      name: 'AbortError',
    });
    cancellation.abort();
    await secondRejected;
    pool.dispose();
    await firstRejected;
    await expect(
      pool.fetch('https://example.test/third')
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it.each(['source', 'pool'])(
    'cancels the HTTP response body after headers through %s disposal',
    async (owner) => {
      const controller = new AbortController();
      const pool = new RequestPool(
        1,
        async (_request, init) =>
          new Response(
            new ReadableStream({
              start(stream) {
                init?.signal?.addEventListener(
                  'abort',
                  () => stream.error(init.signal?.reason),
                  { once: true }
                );
              },
            })
          )
      );
      const response = await pool.fetch('https://example.test/stream', {
        signal: controller.signal,
      });
      const pending = response.body!.getReader().read();
      const rejected = expect(pending).rejects.toMatchObject({
        name: 'AbortError',
      });
      if (owner === 'source') controller.abort();
      else pool.dispose();
      await rejected;
      pool.dispose();
    }
  );
  it('gives each byte source one live chunk owner and keeps loaders independent', async () => {
    const first = createDicomLoader();
    const second = createDicomLoader();
    const source = blobFetcher(blob());
    const chunk = first.createChunk(source);
    expect(() => first.createChunk(source)).toThrow('already belongs');
    second.release(chunk);
    await chunk.loadMeta();
    expect(getDatasetTag(chunk.metadata, '00100010')).toBe('DOE^JOHN');
    first.release(chunk);
    const replacement = first.createChunk(source);
    await replacement.loadMeta();
    expect(getDatasetTag(replacement.metadata, '00100010')).toBe('DOE^JOHN');
    first.dispose();
    second.dispose();
  });
});
