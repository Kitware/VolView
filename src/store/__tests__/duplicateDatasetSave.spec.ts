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
});
