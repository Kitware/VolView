import { DicomMetaLoader } from '@/src/core/streaming/dicom/dicomMetaLoader';
import { RequestPool } from '@/src/core/streaming/requestPool';
import { CachedStreamFetcher } from '@/src/core/streaming/cachedStreamFetcher';
import { describe, it, expect } from 'vitest';

describe('dicomMetaLoader', () => {
  it('should load only metadata', async () => {
    const pool = new RequestPool();
    const fetcher = new CachedStreamFetcher(
      'https://data.kitware.com/api/v1/file/57b5d4648d777f10f2693e7e/download',
      {
        fetch: pool.fetch,
      }
    );
    const loader = new DicomMetaLoader(fetcher, () => {
      return [];
    });
    await loader.load();

    const downloaded = fetcher.cachedChunks.reduce(
      (sum, chunk) => sum + chunk.length,
      0
    );
    // metadata header fits within 4096
    expect(downloaded).to.be.lessThanOrEqual(4096);
  });
});
