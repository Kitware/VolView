import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { Chunk } from '@/src/core/streaming/chunk';
import { Tags } from '@/src/core/dicomTags';
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';
import type { ChunkSource, DataSource } from '@/src/io/import/dataSource';
import { uriToDataSource } from '@/src/io/import/dataSource';
import { importDicomChunkSources } from '@/src/io/import/importDataSources';
import { useDatasetStore } from '@/src/store/datasets';
import type { ImportChunksResult } from '@/src/store/datasets-dicom';

// A replan can fold one collection into another. The dataset the dissolved id
// owned has to go, and the survivor has to name the member it inherited, or a
// later save writes a dangling dataset and loses that instance.

const chunkSourceFor = (sop: string) => {
  const source: DataSource = {
    type: 'chunk',
    chunk: { metadata: [[Tags.SOPInstanceUID, sop]] } as unknown as Chunk,
    mime: FILE_EXT_TO_MIME.dcm,
    parent: uriToDataSource(
      `https://ex/series/${sop}.dcm`,
      `${sop}.dcm`,
      FILE_EXT_TO_MIME.dcm
    ),
  };
  return source as DataSource & ChunkSource;
};

const collectedSops = (dataSource: DataSource | undefined) => {
  if (dataSource?.type !== 'collection') throw new Error('Expected collection');
  return dataSource.sources.map((src) => {
    if (src.type !== 'chunk') throw new Error('Expected a chunk source');
    return Object.fromEntries(src.chunk.metadata!)[Tags.SOPInstanceUID];
  });
};

describe('importDicomChunkSources', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('inherits a moved member and drops the dissolved dataset', async () => {
    const datasetStore = useDatasetStore();
    const [a, b, c] = ['sop-a', 'sop-b', 'sop-c'].map(chunkSourceFor);

    // Stands in for the store: a dissolved id is removed, then the commit
    // is reported, as commitPlan does.
    const load = (sources: ChunkSource[], result: ImportChunksResult) =>
      importDicomChunkSources(
        sources,
        async (_chunks, { onCommitted, removeDissolved }) => {
          result.dissolved.forEach(removeDissolved);
          onCommitted(result);
          return result;
        }
      );

    await load([a, b], {
      volumes: { 'vol-1': [a.chunk], 'vol-2': [b.chunk] },
      dissolved: [],
    });
    expect(datasetStore.getDataSource('vol-2')).toBeDefined();

    await load([c], {
      volumes: { 'vol-1': [a.chunk, b.chunk, c.chunk] },
      dissolved: ['vol-2'],
    });

    expect(datasetStore.getDataSource('vol-2')).toBeUndefined();
    expect(collectedSops(datasetStore.getDataSource('vol-1'))).toEqual([
      'sop-a',
      'sop-b',
      'sop-c',
    ]);
  });
});
