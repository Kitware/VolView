import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

import {
  loadDataSources,
  loadUrlsWithOutcome,
  type DataSourceImporter,
} from '@/src/actions/loadUserFiles';
import useLoadDataStore from '@/src/store/load-data';
import type { DataSource } from '@/src/io/import/dataSource';
import {
  asErrorResult,
  asOkayResult,
  type ImportDataSourcesResult,
} from '@/src/io/import/common';

// ---------------------------------------------------------------------------
// ONE consolidated notice for degraded composed opens: importDataSources owns
// reporting for failures it has already surfaced (e.g. a failed state-file
// leaf, counted by completeStateFileRestore's consolidated "Some scene
// content could not be restored" warning) and returns them as 'ok' results —
// so the generic error-styled "Some files failed to load" fires exactly for
// the error results loadDataSources receives, no more and no less.
// ---------------------------------------------------------------------------

// Returns whatever the test lined up, one queued batch per call.
const importerServing = (
  ...batches: Array<ImportDataSourcesResult[]>
): DataSourceImporter => {
  const queue = [...batches];
  return async () => queue.shift() ?? [];
};

// What importDataSources returns for a failure it already surfaced itself.
const coveredFailure = (source: DataSource) => asOkayResult(source);

const composedLeaf = (stateID: string): DataSource => ({
  type: 'uri',
  uri: `https://girder.example/file/${stateID}`,
  name: `${stateID}.nrrd`,
  stateFileLeaf: { stateID },
});

const standaloneSource = (): DataSource => ({
  type: 'uri',
  uri: 'https://example.com/plain.nrrd',
  name: 'plain.nrrd',
});

describe('loadDataSources — notice exclusivity for restore-covered failures', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('a restore-covered failure does NOT raise the generic load error', async () => {
    const leaf = composedLeaf('ds-a');
    const spy = vi.spyOn(useLoadDataStore(), 'setError');

    await loadDataSources([leaf], importerServing([coveredFailure(leaf)]));

    expect(spy).not.toHaveBeenCalled();
  });

  it('a returned error result still raises the generic load error', async () => {
    const source = standaloneSource();
    const spy = vi.spyOn(useLoadDataStore(), 'setError');

    await loadDataSources(
      [source],
      importerServing([asErrorResult(new Error('boom'), source)])
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain('plain.nrrd');
  });

  it('a mixed result reports ONLY the error entries', async () => {
    const leaf = composedLeaf('ds-a');
    const source = standaloneSource();
    const spy = vi.spyOn(useLoadDataStore(), 'setError');

    await loadDataSources(
      [leaf, source],
      importerServing([
        coveredFailure(leaf),
        asErrorResult(new Error('boom'), source),
      ])
    );

    expect(spy).toHaveBeenCalledTimes(1);
    const message = String(spy.mock.calls[0][0]);
    expect(message).toContain('plain.nrrd');
    expect(message).not.toContain('ds-a.nrrd');
  });

  it('distinguishes a successful zero-dataset restore from an uncovered error', async () => {
    const leaf = composedLeaf('ds-a');
    await expect(
      loadUrlsWithOutcome(
        { urls: ['https://example.com/session.volview.json'] },
        importerServing([coveredFailure(leaf)])
      )
    ).resolves.toEqual({ datasetIds: [], hadErrors: false });

    await expect(
      loadUrlsWithOutcome(
        { urls: ['https://example.com/missing.volview.json'] },
        importerServing([
          asErrorResult(new Error('not found'), standaloneSource()),
        ])
      )
    ).resolves.toEqual({ datasetIds: [], hadErrors: true });
  });
});
