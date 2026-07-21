import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyIntent,
  autoLoadProcessingResults,
} from '@/src/processing/applyResults';
import type {
  ProcessingResult,
  SubmittedJobContext,
} from '@/src/processing/types';

const mocks = vi.hoisted(() => ({
  uriToDataSource: vi.fn(),
  importVolumeDataSources: vi.fn(),
  toDataSelection: vi.fn(),
  isVolumeResult: vi.fn(),
  loadVolumeUrls: vi.fn(),
  addLayer: vi.fn(),
  removeDataset: vi.fn(),
  convertImageToLabelmap: vi.fn(),
  updateSegment: vi.fn(),
  metadataByID: {} as Record<
    string,
    { source?: { providerId: string; jobId: string; outputId: string } }
  >,
  addError: vi.fn(),
}));

vi.mock('@/src/io/import/dataSource', () => ({
  uriToDataSource: mocks.uriToDataSource,
}));
vi.mock('@/src/io/import/importDataSources', () => ({
  importVolumeDataSources: mocks.importVolumeDataSources,
  toDataSelection: mocks.toDataSelection,
}));
vi.mock('@/src/io/import/common', () => ({
  isVolumeResult: mocks.isVolumeResult,
}));
vi.mock('@/src/actions/loadUserFiles', () => ({
  loadVolumeUrls: mocks.loadVolumeUrls,
}));
vi.mock('@/src/store/datasets', () => ({
  useDatasetStore: () => ({ remove: mocks.removeDataset }),
}));
vi.mock('@/src/store/datasets-layers', () => ({
  useLayersStore: () => ({ addLayer: mocks.addLayer }),
}));
vi.mock('@/src/store/segmentGroups', () => ({
  useSegmentGroupStore: () => ({
    convertImageToLabelmap: mocks.convertImageToLabelmap,
    updateSegment: mocks.updateSegment,
    metadataByID: mocks.metadataByID,
  }),
}));
vi.mock('@/src/store/messages', () => ({
  useMessageStore: () => ({ addError: mocks.addError }),
}));

const file = { id: 'r1', url: 'https://example/out.nrrd', name: 'out.nrrd' };
const rgba = (r: number, g: number, b: number, a: number) =>
  [r, g, b, a] as [number, number, number, number];

const context = (activeDatasetId?: string): SubmittedJobContext => ({
  jobId: 'j1',
  taskId: 't1',
  providerId: 'p1',
  submittedAt: '2026-06-16T00:00:00Z',
  activeDatasetId,
});

const result = (
  overrides: Partial<ProcessingResult> = {}
): ProcessingResult => ({
  id: 'r1',
  name: file.name,
  url: file.url,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.metadataByID = {};
  mocks.uriToDataSource.mockReturnValue({ type: 'uri' });
  mocks.importVolumeDataSources.mockResolvedValue([
    { type: 'data', dataID: 'child-1' },
  ]);
  mocks.isVolumeResult.mockReturnValue(true);
  mocks.toDataSelection.mockReturnValue('child-selection');
  mocks.loadVolumeUrls.mockResolvedValue(['dataset-live']);
  mocks.convertImageToLabelmap.mockResolvedValue(['seg-group']);
  mocks.addLayer.mockResolvedValue('layer-1');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('applyIntent', () => {
  it('add-base-image opens the file as a new dataset', async () => {
    const applied = await applyIntent(
      { intent: 'add-base-image', ...file },
      context('parent')
    );
    expect(applied.status).toBe('applied');
    expect(mocks.loadVolumeUrls).toHaveBeenCalledWith({
      urls: [file.url],
      names: [file.name],
    });
    expect(mocks.addLayer).not.toHaveBeenCalled();
    expect(mocks.convertImageToLabelmap).not.toHaveBeenCalled();
  });

  it('add-layer attaches a layer onto the originating dataset', async () => {
    const applied = await applyIntent(
      { intent: 'add-layer', ...file },
      context('parent')
    );
    expect(applied.status).toBe('applied');
    expect(mocks.addLayer).toHaveBeenCalledWith('parent', 'child-selection');
    expect(mocks.importVolumeDataSources).toHaveBeenCalledWith([
      { type: 'uri' },
    ]);
    expect(mocks.loadVolumeUrls).not.toHaveBeenCalled();
  });

  it('add-layer with no originating dataset falls back to opening', async () => {
    await applyIntent({ intent: 'add-layer', ...file }, context(undefined));
    expect(mocks.addLayer).not.toHaveBeenCalled();
    expect(mocks.loadVolumeUrls).toHaveBeenCalledWith({
      urls: [file.url],
      names: [file.name],
    });
  });

  it('add-segment-group converts the labelmap and applies descriptors to the created group', async () => {
    mocks.convertImageToLabelmap.mockResolvedValue(['group-1']);
    const segments = [
      { value: 1, name: 'liver', color: rgba(255, 0, 0, 255) },
      { value: 2, name: 'tumor', color: rgba(0, 255, 0, 255), visible: false },
    ];
    await applyIntent(
      { intent: 'add-segment-group', ...file, segments },
      context('parent')
    );
    expect(mocks.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      undefined
    );
    expect(mocks.updateSegment).toHaveBeenCalledTimes(2);
    expect(mocks.updateSegment).toHaveBeenCalledWith('group-1', 1, {
      name: 'liver',
      color: [255, 0, 0, 255],
    });
    expect(mocks.updateSegment).toHaveBeenCalledWith('group-1', 2, {
      name: 'tumor',
      color: [0, 255, 0, 255],
      visible: false,
    });
    expect(mocks.loadVolumeUrls).not.toHaveBeenCalled();
  });

  it('add-segment-group removes the temporarily imported child dataset', async () => {
    const outcome = await applyIntent(
      { intent: 'add-segment-group', ...file },
      context('parent')
    );
    expect(outcome.status).toBe('applied');
    expect(mocks.removeDataset).toHaveBeenCalledWith('child-selection');
    expect(mocks.removeDataset.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.convertImageToLabelmap.mock.invocationCallOrder[0]
    );
  });

  it('add-segment-group removes the imported child even when conversion fails', async () => {
    mocks.convertImageToLabelmap.mockRejectedValue(
      new Error('bounds do not intersect')
    );
    const outcome = await applyIntent(
      { intent: 'add-segment-group', ...file },
      context('parent')
    );
    expect(outcome.status).toBe('failed');
    expect(mocks.removeDataset).toHaveBeenCalledWith('child-selection');
  });

  it('add-layer keeps its imported child dataset (the layer references it)', async () => {
    const outcome = await applyIntent(
      { intent: 'add-layer', ...file },
      context('parent')
    );
    expect(outcome.status).toBe('applied');
    expect(mocks.removeDataset).not.toHaveBeenCalled();
  });

  it('add-segment-group with no segments still converts (embedded metadata)', async () => {
    await applyIntent(
      { intent: 'add-segment-group', ...file },
      context('parent')
    );
    expect(mocks.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      undefined
    );
    expect(mocks.updateSegment).not.toHaveBeenCalled();
  });

  it('stamps the provider-qualified source tag on the created group', async () => {
    const source = {
      providerId: 'p1',
      jobId: 'job-abc123',
      outputId: 'outputLabelmap',
    };
    await applyIntent(
      { intent: 'add-segment-group', ...file, source },
      context('parent')
    );
    expect(mocks.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      source
    );
  });

  it('treats a restored segment-group result as already applied', async () => {
    const source = {
      providerId: 'p1',
      jobId: 'job-abc123',
      outputId: 'outputLabelmap',
    };
    mocks.metadataByID = { restored: { source } };

    const outcome = await applyIntent(
      { intent: 'add-segment-group', ...file, source },
      context('parent')
    );

    expect(outcome.status).toBe('applied');
    expect(mocks.importVolumeDataSources).not.toHaveBeenCalled();
    expect(mocks.convertImageToLabelmap).not.toHaveBeenCalled();
    expect(mocks.loadVolumeUrls).not.toHaveBeenCalled();
  });

  it('applies a different output from the same restored job', async () => {
    mocks.metadataByID = {
      restored: {
        source: {
          providerId: 'p1',
          jobId: 'job-abc123',
          outputId: 'existing-output',
        },
      },
    };
    const source = {
      providerId: 'p1',
      jobId: 'job-abc123',
      outputId: 'new-output',
    };

    const outcome = await applyIntent(
      { intent: 'add-segment-group', ...file, source },
      context('parent')
    );

    expect(outcome.status).toBe('applied');
    expect(mocks.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      source
    );
  });

  it('applies matching raw job and output ids from a different provider', async () => {
    mocks.metadataByID = {
      restored: {
        source: {
          providerId: 'provider-a',
          jobId: '1',
          outputId: 'seg',
        },
      },
    };
    const source = {
      providerId: 'provider-b',
      jobId: '1',
      outputId: 'seg',
    };

    const outcome = await applyIntent(
      { intent: 'add-segment-group', ...file, source },
      context('parent')
    );

    expect(outcome.status).toBe('applied');
    expect(mocks.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      source
    );
  });

  it('does not infer an application receipt when provenance is absent', async () => {
    mocks.metadataByID = { restored: {} };

    const outcome = await applyIntent(
      { intent: 'add-segment-group', ...file },
      context('parent')
    );

    expect(outcome.status).toBe('applied');
    expect(mocks.convertImageToLabelmap).toHaveBeenCalledTimes(1);
  });

  it('add-segment-group with no originating dataset falls back to opening', async () => {
    await applyIntent(
      { intent: 'add-segment-group', ...file },
      context(undefined)
    );
    expect(mocks.convertImageToLabelmap).not.toHaveBeenCalled();
    expect(mocks.loadVolumeUrls).toHaveBeenCalledWith({
      urls: [file.url],
      names: [file.name],
    });
  });

  it('add-segment-group reports an explicit failure when the result fails to load (#7)', async () => {
    mocks.importVolumeDataSources.mockResolvedValue([]);
    const applied = await applyIntent(
      { intent: 'add-segment-group', ...file },
      context('parent')
    );
    expect(mocks.convertImageToLabelmap).not.toHaveBeenCalled();
    expect(applied.status).toBe('failed');
    expect(mocks.addError).not.toHaveBeenCalled();
  });

  it('add-layer reports an explicit failure when the result fails to load (#7)', async () => {
    mocks.importVolumeDataSources.mockResolvedValue([]);
    const applied = await applyIntent(
      { intent: 'add-layer', ...file },
      context('parent')
    );
    expect(mocks.addLayer).not.toHaveBeenCalled();
    expect(applied.status).toBe('failed');
    expect(mocks.addError).not.toHaveBeenCalled();
  });

  it('resolves to failed (never rejects) when the fallback open throws', async () => {
    mocks.loadVolumeUrls.mockRejectedValue(new Error('bad result url'));
    const applied = await applyIntent(
      { intent: 'add-base-image', ...file },
      context('parent')
    );
    expect(applied.status).toBe('failed');
  });

  it('add-layer reports failure when the layer fails to build (addLayer swallows the throw)', async () => {
    mocks.addLayer.mockResolvedValue(undefined);
    const applied = await applyIntent(
      { intent: 'add-layer', ...file },
      context('parent')
    );
    expect(mocks.addLayer).toHaveBeenCalledWith('parent', 'child-selection');
    expect(applied.status).toBe('failed');
    expect(mocks.removeDataset).toHaveBeenCalledWith('child-selection');
    expect(mocks.addError).not.toHaveBeenCalled();
  });

  it('is additive-only: writes into the NEW group, never a pre-existing one', async () => {
    mocks.metadataByID = { 'existing-group': {} };
    mocks.convertImageToLabelmap.mockResolvedValue(['new-group']);
    await applyIntent(
      {
        intent: 'add-segment-group',
        ...file,
        segments: [{ value: 1, name: 'liver', color: rgba(1, 2, 3, 4) }],
      },
      context('parent')
    );
    expect(mocks.convertImageToLabelmap).toHaveBeenCalledTimes(1);
    expect(mocks.updateSegment).toHaveBeenCalledWith(
      'new-group',
      1,
      expect.anything()
    );
    expect(mocks.updateSegment).not.toHaveBeenCalledWith(
      'existing-group',
      expect.anything(),
      expect.anything()
    );
  });
});

describe('autoLoadProcessingResults', () => {
  it('routes every supported intent through the shared applier', async () => {
    mocks.convertImageToLabelmap.mockResolvedValue(['seg-group']);
    await autoLoadProcessingResults(
      [
        result({ id: 'a', intent: 'add-base-image' }),
        result({ id: 'b', intent: 'add-layer' }),
        result({
          id: 'c',
          intent: 'add-segment-group',
          source: { providerId: 'p1', jobId: 'j1', outputId: 'seg' },
          segments: [{ value: 1, name: 'liver', color: rgba(1, 2, 3, 4) }],
        }),
      ],
      context('parent')
    );
    expect(mocks.convertImageToLabelmap).toHaveBeenCalledTimes(1);
    expect(mocks.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      { providerId: 'p1', jobId: 'j1', outputId: 'seg' }
    );
    expect(mocks.updateSegment).toHaveBeenCalledTimes(1);
    expect(mocks.loadVolumeUrls).toHaveBeenCalledTimes(1);
    expect(mocks.loadVolumeUrls).toHaveBeenCalledWith({
      urls: [file.url],
      names: [file.name],
    });
    expect(mocks.addLayer).toHaveBeenCalledWith('parent', 'child-selection');
  });

  it('does not auto-apply an unknown intent', async () => {
    await autoLoadProcessingResults(
      [result({ intent: 'add-polygon' })],
      context('parent')
    );
    expect(mocks.convertImageToLabelmap).not.toHaveBeenCalled();
    expect(mocks.loadVolumeUrls).not.toHaveBeenCalled();
  });

  it('opens base images even when there is no originating dataset', async () => {
    await autoLoadProcessingResults(
      [result({ intent: 'add-base-image' })],
      context(undefined)
    );
    expect(mocks.loadVolumeUrls).toHaveBeenCalledWith({
      urls: [file.url],
      names: [file.name],
    });
    expect(mocks.convertImageToLabelmap).not.toHaveBeenCalled();
  });

  it('opens a parentless segment-group result as an ordinary dataset', async () => {
    await autoLoadProcessingResults(
      [result({ intent: 'add-segment-group' })],
      context(undefined)
    );
    expect(mocks.convertImageToLabelmap).not.toHaveBeenCalled();
    expect(mocks.loadVolumeUrls).toHaveBeenCalledWith({
      urls: [file.url],
      names: [file.name],
    });
  });

  it('keeps applying after one segment-group result throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.convertImageToLabelmap
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(['g2']);
    const application = await autoLoadProcessingResults(
      [
        result({ id: 'a', intent: 'add-segment-group' }),
        result({ id: 'b', intent: 'add-segment-group' }),
      ],
      context('parent')
    );
    expect(mocks.convertImageToLabelmap).toHaveBeenCalledTimes(2);
    expect(err).toHaveBeenCalled();
    expect(application.failedResultIds).toEqual(['a']);
  });

  it('reports success when every known intent applies', async () => {
    const application = await autoLoadProcessingResults(
      [result({ intent: 'add-base-image' })],
      context('parent')
    );

    expect(application.failedResultIds).toEqual([]);
  });

  it('skips a restored output while applying unmatched results from the same job', async () => {
    const restoredSource = {
      providerId: 'p1',
      jobId: 'j1',
      outputId: 'restored',
    };
    const newSource = {
      providerId: 'p1',
      jobId: 'j1',
      outputId: 'new',
    };
    mocks.metadataByID = { restored: { source: restoredSource } };

    const application = await autoLoadProcessingResults(
      [
        result({
          id: 'restored',
          intent: 'add-segment-group',
          source: restoredSource,
        }),
        result({
          id: 'new',
          intent: 'add-segment-group',
          source: newSource,
        }),
      ],
      context('parent')
    );

    expect(application.failedResultIds).toEqual([]);
    expect(mocks.importVolumeDataSources).toHaveBeenCalledTimes(1);
    expect(mocks.convertImageToLabelmap).toHaveBeenCalledTimes(1);
    expect(mocks.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      newSource
    );
  });
});

describe('autoLoadProcessingResults — labelmap auto-apply', () => {
  const segResult = (overrides: Partial<ProcessingResult> = {}) =>
    result({ id: 'seg', intent: 'add-segment-group', ...overrides });

  it('auto-applies an importable labelmap', async () => {
    mocks.convertImageToLabelmap.mockResolvedValue(['seg-group']);
    await autoLoadProcessingResults([segResult()], context('parent'));
    expect(mocks.convertImageToLabelmap).toHaveBeenCalledTimes(1);
  });

  it('lets the conversion path decide whether an imported labelmap can attach', async () => {
    await autoLoadProcessingResults([segResult()], context('parent'));
    expect(mocks.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      undefined
    );
  });

  it('does not auto-apply a result that fails to decode, and surfaces the failure', async () => {
    mocks.importVolumeDataSources.mockResolvedValue([]);
    await autoLoadProcessingResults([segResult()], context('parent'));
    expect(mocks.convertImageToLabelmap).not.toHaveBeenCalled();
    expect(mocks.addError).toHaveBeenCalled();
  });
});

describe('autoLoadProcessingResults — born-persistent (no confirm gate)', () => {
  it('applies the group immediately with no confirm gate', async () => {
    const source = { providerId: 'p1', jobId: 'j1', outputId: 'seg' };
    mocks.convertImageToLabelmap.mockResolvedValue(['seg-group']);
    await autoLoadProcessingResults(
      [result({ id: 'seg', intent: 'add-segment-group', source })],
      context('parent')
    );
    expect(mocks.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      source
    );
  });
});
