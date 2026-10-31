import { datasetFromTags } from '@/tests/dicomDataset';
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
import type { Chunk } from '@/packages/dicom/core';
import { Tags } from '@/packages/dicom/core';
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

  const dicomCollection = (
    instances: string[],
    parent: (instance: string) => DataSource
  ): DataSource => ({
    type: 'collection',
    sources: instances.map((instance) => ({
      type: 'chunk',
      chunk: {
        metadata: datasetFromTags([[Tags.SOPInstanceUID, instance]]),
      } as Chunk,
      mime: FILE_EXT_TO_MIME.dcm,
      parent: parent(instance),
    })),
  });

  const dicomBatch = (instances: string[]) =>
    dicomCollection(instances, (instance) =>
      uriToDataSource(
        `https://ex/series/${instance}.dcm`,
        `${instance}.dcm`,
        FILE_EXT_TO_MIME.dcm
      )
    );

  const localDicomBatch = (instances: string[]) =>
    dicomCollection(instances, (instance) => ({
      type: 'file',
      file: new File([instance], `${instance}.dcm`, {
        type: FILE_EXT_TO_MIME.dcm,
        lastModified: 1,
      }),
      fileType: FILE_EXT_TO_MIME.dcm,
    }));

  // A re-import reports every member the volume now holds, so the later
  // collection is the complete one.
  it('saves the membership the latest import reports for a dataset', async () => {
    const store = useDatasetStore();
    store.addDataSources([
      { dataID: 'series-1', dataSource: dicomBatch(['sop-1', 'sop-2']) },
    ]);
    store.addDataSources([
      {
        dataID: 'series-1',
        dataSource: dicomBatch(['sop-1', 'sop-2', 'sop-3', 'sop-4']),
      },
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

  it('drops a member a replan moved to another dataset', () => {
    const store = useDatasetStore();
    store.addDataSources([
      { dataID: 'series-1', dataSource: dicomBatch(['sop-1', 'sop-2']) },
    ]);
    store.addDataSources([
      { dataID: 'series-1', dataSource: dicomBatch(['sop-1']) },
    ]);

    const source = store.getDataSource('series-1');
    if (source?.type !== 'collection') throw new Error('Expected collection');
    expect(source.sources).toHaveLength(1);
  });

  it('keeps remote provenance for a member the re-import supplies locally', () => {
    const store = useDatasetStore();
    store.addDataSources([
      { dataID: 'series-1', dataSource: dicomBatch(['sop-1', 'sop-2']) },
    ]);
    store.addDataSources([
      { dataID: 'series-1', dataSource: localDicomBatch(['sop-1', 'sop-2']) },
    ]);

    expect(isRemoteDataSource(store.getDataSource('series-1'))).toBe(true);
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

it('saves one shared archive File used by distinct restored dataset leaves', async () => {
  setActivePinia(createPinia());
  const file = new File(['zip bytes'], 'series.zip', {
    type: 'application/zip',
  });
  const store = useDatasetStore();
  store.addDataSources(
    ['a', 'b'].map((name) => ({
      dataID: name,
      dataSource: {
        type: 'archive' as const,
        path: name + '/slice.dcm',
        parent: { type: 'file' as const, file, fileType: 'application/zip' },
      },
    }))
  );
  const zip = new JSZip();
  const manifest = {
    version: MANIFEST_VERSION,
    dataSources: [],
    datasets: [],
  } as Manifest;
  await store.serialize({ zip, manifest });
  expect(manifest.datasets).toHaveLength(2);
  expect(
    manifest.dataSources.filter((source) => source.type === 'file')
  ).toHaveLength(1);
  expect(Object.keys(manifest.datasetFilePath!)).toHaveLength(1);
  expect(() => normalizeManifest(manifest, zip)).not.toThrow();
});
