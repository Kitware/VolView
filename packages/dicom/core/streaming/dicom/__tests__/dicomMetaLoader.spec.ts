import { DicomMetaLoader } from '../dicomMetaLoader';
import { RequestPool } from '../../requestPool';
import { CachedStreamFetcher } from '../../cachedStreamFetcher';
import { describe, it, expect } from 'vitest';
import { syntheticSlice, bytesFetcher } from '@/tests/dicomSourceFixtures';
import { getDatasetTag } from '../../../metadata/datasetAccess';
import { findElement, readDicomDataset } from '../../../metadata/dicomDataset';
import { sequenceItems } from '../../../metadata/functionalGroups';
import { createDicomLoader } from '../../../runtime/createDicomLoader';
import { concatBytes } from '../../../utils';
import { rawElement, sequenceItem } from '@/tests/specs/syntheticDicom';

describe('dicomMetaLoader', () => {
  it('retains public nested metadata without retaining private payloads', async () => {
    const privateElement = rawElement(
      0x0029,
      0x1010,
      'OB',
      new Uint8Array(100_000).fill(0x41)
    );
    const bytes = syntheticSlice({
      extraElements: [
        privateElement,
        rawElement(
          0x0008,
          0x1140,
          'SQ',
          sequenceItem(
            concatBytes([
              rawElement(8, 0x1155, 'UI', new TextEncoder().encode('1.2.3\0')),
              privateElement,
            ])
          )
        ),
      ],
    });
    expect(findElement(readDicomDataset(bytes), '00291010')).toBeDefined();
    const loader = createDicomLoader();
    const chunk = loader.createChunk(bytesFetcher(bytes, 64));
    await chunk.loadMeta();
    expect(findElement(chunk.metadata!, '00291010')).toBeUndefined();
    const reference = sequenceItems(chunk.metadata!, '00081140')[0];
    expect(getDatasetTag(reference, '00081155')).toBe('1.2.3');
    expect(findElement(reference, '00291010')).toBeUndefined();
    await chunk.loadData();
    expect(new Uint8Array(await chunk.dataBlob!.arrayBuffer())).toEqual(bytes);
    loader.dispose();
  });

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
