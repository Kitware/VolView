import { DicomMetaLoader } from '../dicomMetaLoader';
import { RequestPool } from '../../requestPool';
import { CachedStreamFetcher } from '../../cachedStreamFetcher';
import { describe, it, expect } from 'vitest';
import { syntheticSlice, bytesFetcher } from '@/tests/dicomSourceFixtures';
import { getDatasetTag } from '../../../metadata/datasetAccess';

describe('dicomMetaLoader', () => {
  it('loads only the header from an HTTP response', async () => {
    const bytes = syntheticSlice({ patientName: 'DOE^JOHN' });
    const source = bytesFetcher(bytes, 64);
    const pool = new RequestPool(1, async () => {
      await source.connect();
      return new Response(source.getStream(), {
        headers: { 'content-length': String(bytes.length) },
      });
    });
    const fetcher = new CachedStreamFetcher('https://example.test/slice.dcm', {
      fetch: pool.fetch,
    });
    const loader = new DicomMetaLoader(fetcher);
    await loader.load();
    expect(getDatasetTag(loader.meta, '00100010')).toBe('DOE^JOHN');
    expect(fetcher.size).toBeLessThan(bytes.length);
    loader.dispose();
    pool.dispose();
  });
});
