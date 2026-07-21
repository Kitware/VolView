import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

import { loadDataSources } from '@/src/actions/loadUserFiles';
import useLoadDataStore from '@/src/store/load-data';
import type { DataSource } from '@/src/io/import/dataSource';
import { asErrorResult, ErrorResult } from '@/src/io/import/common';

// ---------------------------------------------------------------------------
// ONE consolidated notice for degraded composed opens: importDataSources flags
// error results it has already surfaced (e.g. a failed state-file leaf,
// counted by completeStateFileRestore's consolidated "Some scene content
// could not be restored" warning) — the generic error-styled "Some files
// failed to load" must NOT fire again for those. Only unflagged failures keep
// the generic error.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  importDataSources: vi.fn(),
}));

vi.mock('@/src/io/import/importDataSources', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/src/io/import/importDataSources')>();
  return { ...actual, importDataSources: mocks.importDataSources };
});

const reportedError = (source: DataSource): ErrorResult => ({
  ...asErrorResult(new Error('fetch failed'), source),
  alreadyReported: true,
});

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

describe('loadDataSources — notice exclusivity for already-reported failures', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mocks.importDataSources.mockReset();
  });

  it('an already-reported failure does NOT raise the generic load error', async () => {
    const leaf = composedLeaf('ds-a');
    mocks.importDataSources.mockResolvedValue([reportedError(leaf)]);
    const spy = vi.spyOn(useLoadDataStore(), 'setError');

    await loadDataSources([leaf]);

    expect(spy).not.toHaveBeenCalled();
  });

  it('an unflagged failed import still raises the generic load error', async () => {
    const source = standaloneSource();
    mocks.importDataSources.mockResolvedValue([
      asErrorResult(new Error('boom'), source),
    ]);
    const spy = vi.spyOn(useLoadDataStore(), 'setError');

    await loadDataSources([source]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain('plain.nrrd');
  });

  it('a mixed failure reports ONLY the unflagged entries', async () => {
    const leaf = composedLeaf('ds-a');
    const source = standaloneSource();
    mocks.importDataSources.mockResolvedValue([
      reportedError(leaf),
      asErrorResult(new Error('boom'), source),
    ]);
    const spy = vi.spyOn(useLoadDataStore(), 'setError');

    await loadDataSources([leaf, source]);

    expect(spy).toHaveBeenCalledTimes(1);
    const message = String(spy.mock.calls[0][0]);
    expect(message).toContain('plain.nrrd');
    expect(message).not.toContain('ds-a.nrrd');
  });
});
