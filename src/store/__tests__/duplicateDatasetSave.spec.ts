import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import JSZip from 'jszip';
import { useDatasetStore } from '@/src/store/datasets';
import { uriToDataSource } from '@/src/io/import/dataSource';
import {
  normalizeManifest,
  MANIFEST_VERSION,
} from '@/src/io/state-file/serialize';
import type { Manifest } from '@/src/io/state-file/schema';
import {
  isRemoteDataSource,
  type DataSource,
} from '@/src/io/import/dataSource';
import type { Chunk } from '@/src/core/streaming/chunk';
import { Tags } from '@/src/core/dicomTags';
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';

// ---------------------------------------------------------------------------
// Regression: importing the same data twice (e.g. dragging the same DICOM
// folder in again) yields the same dataID. The provenance list must not grow a
// duplicate entry for it — a duplicate dataset id makes validateCoreGraph
// abort the save that used to succeed.
// ---------------------------------------------------------------------------

describe('dataset provenance dedup on re-import', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('re-adding an already-loaded dataID neither duplicates it nor aborts save', async () => {
    const store = useDatasetStore();
    const dataSource = uriToDataSource('https://ex/ct.nrrd', 'ct.nrrd');
    store.addDataSources([{ dataID: 'vol-1', dataSource }]);
    store.addDataSources([{ dataID: 'vol-1', dataSource }]);

    const zip = new JSZip();
    const manifest = {
      version: MANIFEST_VERSION,
      datasets: [],
      dataSources: [],
      datasetFilePath: {},
    } as Manifest;
    await store.serialize({ zip, manifest });

    expect(manifest.datasets).toHaveLength(1);
    expect(() => normalizeManifest(manifest, zip)).not.toThrow();
  });

  const dicomBatch = (instances: string[]): DataSource => ({
    type: 'collection',
    sources: instances.map((instance) => ({
      type: 'chunk',
      chunk: {
        metadata: [[Tags.SOPInstanceUID, instance]],
      } as Chunk,
      mime: FILE_EXT_TO_MIME.dcm,
      parent: uriToDataSource(
        `https://ex/series/${instance}.dcm`,
        `${instance}.dcm`,
        FILE_EXT_TO_MIME.dcm
      ),
    })),
  });

  const localDicomBatch = (instances: string[]): DataSource => ({
    type: 'collection',
    sources: instances.map((instance) => ({
      type: 'chunk',
      chunk: {
        metadata: [[Tags.SOPInstanceUID, instance]],
      } as Chunk,
      mime: FILE_EXT_TO_MIME.dcm,
      parent: {
        type: 'file',
        file: new File([instance], `${instance}.dcm`, {
          type: FILE_EXT_TO_MIME.dcm,
          lastModified: 1,
        }),
        fileType: FILE_EXT_TO_MIME.dcm,
      },
    })),
  });

  it('merges complementary DICOM batches into one complete saved dataset', async () => {
    const store = useDatasetStore();
    store.addDataSources([
      { dataID: 'series-1', dataSource: dicomBatch(['sop-1', 'sop-2']) },
    ]);
    store.addDataSources([
      { dataID: 'series-1', dataSource: dicomBatch(['sop-3', 'sop-4']) },
    ]);

    const zip = new JSZip();
    const manifest = {
      version: MANIFEST_VERSION,
      datasets: [],
      dataSources: [],
      datasetFilePath: {},
    } as Manifest;
    await store.serialize({ zip, manifest });

    expect(manifest.datasets).toHaveLength(1);
    const datasetSourceId = manifest.datasets![0].dataSourceId;
    const collection = manifest.dataSources.find(
      (source) => source.id === datasetSourceId
    );
    expect(collection).toMatchObject({
      type: 'collection',
      sources: expect.any(Array),
    });
    if (collection?.type !== 'collection') {
      throw new Error('Expected collection');
    }
    expect(collection.sources).toHaveLength(4);
    expect(() => normalizeManifest(manifest, zip)).not.toThrow();
  });

  it('deduplicates repeated DICOM instances by SOP Instance UID', async () => {
    const store = useDatasetStore();
    store.addDataSources([
      { dataID: 'series-1', dataSource: dicomBatch(['sop-1', 'sop-2']) },
    ]);
    store.addDataSources([
      { dataID: 'series-1', dataSource: dicomBatch(['sop-1', 'sop-2']) },
    ]);

    const zip = new JSZip();
    const manifest = {
      version: MANIFEST_VERSION,
      datasets: [],
      dataSources: [],
      datasetFilePath: {},
    } as Manifest;
    await store.serialize({ zip, manifest });

    const datasetSourceId = manifest.datasets![0].dataSourceId;
    const collection = manifest.dataSources.find(
      (source) => source.id === datasetSourceId
    );
    if (collection?.type !== 'collection') {
      throw new Error('Expected collection');
    }
    expect(collection.sources).toHaveLength(2);
  });

  it('replaces local provenance when the same instances are re-imported remotely', () => {
    const store = useDatasetStore();
    store.addDataSources([
      { dataID: 'series-1', dataSource: localDicomBatch(['sop-1', 'sop-2']) },
    ]);
    store.addDataSources([
      { dataID: 'series-1', dataSource: dicomBatch(['sop-1', 'sop-2']) },
    ]);

    expect(isRemoteDataSource(store.getDataSource('series-1'))).toBe(true);
  });
});
