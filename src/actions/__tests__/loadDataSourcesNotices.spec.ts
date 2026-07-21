import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

import {
  loadDataSources,
  loadUrlsWithOutcome,
} from '@/src/actions/loadUserFiles';
import useLoadDataStore from '@/src/store/load-data';
import type { DataSource } from '@/src/io/import/dataSource';
import { asErrorResult, asOkayResult } from '@/src/io/import/common';

// ---------------------------------------------------------------------------
// ONE consolidated notice for degraded composed opens: importDataSources owns
// reporting for failures it has already surfaced (e.g. a failed state-file
// leaf, counted by completeStateFileRestore's consolidated "Some scene
// content could not be restored" warning) and returns them as 'ok' results —
// so the generic error-styled "Some files failed to load" fires exactly for
// the error results loadDataSources receives, no more and no less.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  importDataSources: vi.fn(),
}));

vi.mock('@/src/io/import/importDataSources', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/src/io/import/importDataSources')>();
  return { ...actual, importDataSources: mocks.importDataSources };
});

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
    mocks.importDataSources.mockReset();
  });

  it('a restore-covered failure does NOT raise the generic load error', async () => {
    const leaf = composedLeaf('ds-a');
    mocks.importDataSources.mockResolvedValue([coveredFailure(leaf)]);
    const spy = vi.spyOn(useLoadDataStore(), 'setError');

    await loadDataSources([leaf]);

    expect(spy).not.toHaveBeenCalled();
  });

  it('a returned error result still raises the generic load error', async () => {
    const source = standaloneSource();
    mocks.importDataSources.mockResolvedValue([
      asErrorResult(new Error('boom'), source),
    ]);
    const spy = vi.spyOn(useLoadDataStore(), 'setError');

    await loadDataSources([source]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain('plain.nrrd');
  });

  it('a mixed result reports ONLY the error entries', async () => {
    const leaf = composedLeaf('ds-a');
    const source = standaloneSource();
    mocks.importDataSources.mockResolvedValue([
      coveredFailure(leaf),
      asErrorResult(new Error('boom'), source),
    ]);
    const spy = vi.spyOn(useLoadDataStore(), 'setError');

    await loadDataSources([leaf, source]);

    expect(spy).toHaveBeenCalledTimes(1);
    const message = String(spy.mock.calls[0][0]);
    expect(message).toContain('plain.nrrd');
    expect(message).not.toContain('ds-a.nrrd');
  });

  it('distinguishes a successful zero-dataset restore from an uncovered error', async () => {
    const leaf = composedLeaf('ds-a');
    mocks.importDataSources.mockResolvedValueOnce([coveredFailure(leaf)]);

    await expect(
      loadUrlsWithOutcome({
        urls: ['https://example.com/session.volview.json'],
      })
    ).resolves.toEqual({ datasetIds: [], hadErrors: false });

    mocks.importDataSources.mockResolvedValueOnce([
      asErrorResult(new Error('not found'), standaloneSource()),
    ]);
    await expect(
      loadUrlsWithOutcome({
        urls: ['https://example.com/missing.volview.json'],
      })
    ).resolves.toEqual({ datasetIds: [], hadErrors: true });
  });
});
