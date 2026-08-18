import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import {
  applyIntent,
  autoLoadProcessingResults,
} from '@/src/processing/applyResults';
import type {
  ProcessingResult,
  SubmittedJobContext,
} from '@/src/processing/types';
import type { ResultSource } from '@/backend-contract';
import { useMessageStore } from '@/src/store/messages';

// ---------------------------------------------------------------------------
// Intent routing: which scene edge each result intent reaches for, and what it
// reports back. The download, import and scene-mutation edges are handed in as
// recorders, so the decisions are exercised without a loaded scene; the message
// store is the real one.
// ---------------------------------------------------------------------------

const recordingDependencies = () => ({
  fetchResult: vi.fn(),
  openVolumeUrls: vi.fn(async () => ['dataset-live']),
  importVolume: vi.fn(async (): Promise<string | null> => 'child-selection'),
  removeDataset: vi.fn(),
  addLayer: vi.fn(async (): Promise<string | undefined> => 'layer-1'),
  segmentGroups: {
    resultSourcesInScene: vi.fn((): Array<ResultSource | undefined> => []),
    convertImageToLabelmap: vi.fn(async () => ['seg-group']),
    updateSegment: vi.fn(),
  },
});

let deps = recordingDependencies();

const apply = (
  resultIntent: Parameters<typeof applyIntent>[0],
  jobContext: Parameters<typeof applyIntent>[1]
) => applyIntent(resultIntent, jobContext, deps);

const autoLoad = (
  results: ProcessingResult[],
  jobContext: SubmittedJobContext | undefined
) => autoLoadProcessingResults(results, jobContext, deps);

const errorMessages = () => useMessageStore().messages;

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
  setActivePinia(createPinia());
  deps = recordingDependencies();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('applyIntent', () => {
  it('add-base-image opens the file as a new dataset', async () => {
    const applied = await apply(
      { intent: 'add-base-image', ...file },
      context('parent')
    );
    expect(applied.status).toBe('applied');
    expect(deps.openVolumeUrls).toHaveBeenCalledWith({
      urls: [file.url],
      names: [file.name],
    });
    expect(deps.addLayer).not.toHaveBeenCalled();
    expect(deps.segmentGroups.convertImageToLabelmap).not.toHaveBeenCalled();
  });

  it('add-layer attaches a layer onto the originating dataset', async () => {
    const applied = await apply(
      { intent: 'add-layer', ...file },
      context('parent')
    );
    expect(applied.status).toBe('applied');
    expect(deps.addLayer).toHaveBeenCalledWith('parent', 'child-selection');
    expect(deps.importVolume).toHaveBeenCalledWith(
      expect.objectContaining({ url: file.url, name: file.name })
    );
    expect(deps.openVolumeUrls).not.toHaveBeenCalled();
  });

  it('add-layer with no originating dataset falls back to opening', async () => {
    await apply({ intent: 'add-layer', ...file }, context(undefined));
    expect(deps.addLayer).not.toHaveBeenCalled();
    expect(deps.openVolumeUrls).toHaveBeenCalledWith({
      urls: [file.url],
      names: [file.name],
    });
  });

  it('add-segment-group converts the labelmap and applies descriptors to the created group', async () => {
    deps.segmentGroups.convertImageToLabelmap.mockResolvedValue(['group-1']);
    const segments = [
      { value: 1, name: 'liver', color: rgba(255, 0, 0, 255) },
      { value: 2, name: 'tumor', color: rgba(0, 255, 0, 255), visible: false },
    ];
    await apply(
      { intent: 'add-segment-group', ...file, segments },
      context('parent')
    );
    expect(deps.segmentGroups.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      undefined
    );
    expect(deps.segmentGroups.updateSegment).toHaveBeenCalledTimes(2);
    expect(deps.segmentGroups.updateSegment).toHaveBeenCalledWith(
      'group-1',
      1,
      {
        name: 'liver',
        color: [255, 0, 0, 255],
      }
    );
    expect(deps.segmentGroups.updateSegment).toHaveBeenCalledWith(
      'group-1',
      2,
      {
        name: 'tumor',
        color: [0, 255, 0, 255],
        visible: false,
      }
    );
    expect(deps.openVolumeUrls).not.toHaveBeenCalled();
  });

  it('add-segment-group removes the temporarily imported child dataset', async () => {
    const outcome = await apply(
      { intent: 'add-segment-group', ...file },
      context('parent')
    );
    expect(outcome.status).toBe('applied');
    expect(deps.removeDataset).toHaveBeenCalledWith('child-selection');
    expect(deps.removeDataset.mock.invocationCallOrder[0]).toBeGreaterThan(
      deps.segmentGroups.convertImageToLabelmap.mock.invocationCallOrder[0]
    );
  });

  it('add-segment-group removes the imported child even when conversion fails', async () => {
    deps.segmentGroups.convertImageToLabelmap.mockRejectedValue(
      new Error('bounds do not intersect')
    );
    const outcome = await apply(
      { intent: 'add-segment-group', ...file },
      context('parent')
    );
    expect(outcome.status).toBe('failed');
    expect(deps.removeDataset).toHaveBeenCalledWith('child-selection');
  });

  it('add-layer keeps its imported child dataset (the layer references it)', async () => {
    const outcome = await apply(
      { intent: 'add-layer', ...file },
      context('parent')
    );
    expect(outcome.status).toBe('applied');
    expect(deps.removeDataset).not.toHaveBeenCalled();
  });

  it('add-segment-group with no segments still converts (embedded metadata)', async () => {
    await apply({ intent: 'add-segment-group', ...file }, context('parent'));
    expect(deps.segmentGroups.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      undefined
    );
    expect(deps.segmentGroups.updateSegment).not.toHaveBeenCalled();
  });

  it('stamps structured provider-qualified provenance on the created group', async () => {
    const source = {
      providerId: 'p1',
      jobId: 'job-abc123',
      outputId: 'outputLabelmap',
    };
    await apply(
      { intent: 'add-segment-group', ...file, source },
      context('parent')
    );
    expect(deps.segmentGroups.convertImageToLabelmap).toHaveBeenCalledWith(
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
    deps.segmentGroups.resultSourcesInScene.mockReturnValue([source]);

    const outcome = await apply(
      { intent: 'add-segment-group', ...file, source },
      context('parent')
    );

    expect(outcome.status).toBe('applied');
    expect(deps.importVolume).not.toHaveBeenCalled();
    expect(deps.segmentGroups.convertImageToLabelmap).not.toHaveBeenCalled();
    expect(deps.openVolumeUrls).not.toHaveBeenCalled();
  });

  it('applies a different output from the same restored job', async () => {
    deps.segmentGroups.resultSourcesInScene.mockReturnValue([
      { providerId: 'p1', jobId: 'job-abc123', outputId: 'existing-output' },
    ]);
    const source = {
      providerId: 'p1',
      jobId: 'job-abc123',
      outputId: 'new-output',
    };

    const outcome = await apply(
      { intent: 'add-segment-group', ...file, source },
      context('parent')
    );

    expect(outcome.status).toBe('applied');
    expect(deps.segmentGroups.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      source
    );
  });

  it('applies matching raw job and output ids from a different provider', async () => {
    deps.segmentGroups.resultSourcesInScene.mockReturnValue([
      { providerId: 'provider-a', jobId: '1', outputId: 'seg' },
    ]);
    const source = {
      providerId: 'provider-b',
      jobId: '1',
      outputId: 'seg',
    };

    const outcome = await apply(
      { intent: 'add-segment-group', ...file, source },
      context('parent')
    );

    expect(outcome.status).toBe('applied');
    expect(deps.segmentGroups.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      source
    );
  });

  it('does not infer an application receipt when provenance is absent', async () => {
    deps.segmentGroups.resultSourcesInScene.mockReturnValue([undefined]);

    const outcome = await apply(
      { intent: 'add-segment-group', ...file },
      context('parent')
    );

    expect(outcome.status).toBe('applied');
    expect(deps.segmentGroups.convertImageToLabelmap).toHaveBeenCalledTimes(1);
  });

  it('add-segment-group with no originating dataset falls back to opening', async () => {
    await apply({ intent: 'add-segment-group', ...file }, context(undefined));
    expect(deps.segmentGroups.convertImageToLabelmap).not.toHaveBeenCalled();
    expect(deps.openVolumeUrls).toHaveBeenCalledWith({
      urls: [file.url],
      names: [file.name],
    });
  });

  it('add-segment-group reports an explicit failure when the result fails to load (#7)', async () => {
    deps.importVolume.mockResolvedValue(null);
    const applied = await apply(
      { intent: 'add-segment-group', ...file },
      context('parent')
    );
    expect(deps.segmentGroups.convertImageToLabelmap).not.toHaveBeenCalled();
    expect(applied.status).toBe('failed');
    expect(errorMessages()).toEqual([]);
  });

  it('add-layer reports an explicit failure when the result fails to load (#7)', async () => {
    deps.importVolume.mockResolvedValue(null);
    const applied = await apply(
      { intent: 'add-layer', ...file },
      context('parent')
    );
    expect(deps.addLayer).not.toHaveBeenCalled();
    expect(applied.status).toBe('failed');
    expect(errorMessages()).toEqual([]);
  });

  it('resolves to failed (never rejects) when the fallback open throws', async () => {
    deps.openVolumeUrls.mockRejectedValue(new Error('bad result url'));
    const applied = await apply(
      { intent: 'add-base-image', ...file },
      context('parent')
    );
    expect(applied.status).toBe('failed');
  });

  it('add-layer reports failure when the layer fails to build (addLayer swallows the throw)', async () => {
    deps.addLayer.mockResolvedValue(undefined);
    const applied = await apply(
      { intent: 'add-layer', ...file },
      context('parent')
    );
    expect(deps.addLayer).toHaveBeenCalledWith('parent', 'child-selection');
    expect(applied.status).toBe('failed');
    expect(deps.removeDataset).toHaveBeenCalledWith('child-selection');
    expect(errorMessages()).toEqual([]);
  });

  it('is additive-only: writes into the NEW group, never a pre-existing one', async () => {
    deps.segmentGroups.resultSourcesInScene.mockReturnValue([undefined]);
    deps.segmentGroups.convertImageToLabelmap.mockResolvedValue(['new-group']);
    await apply(
      {
        intent: 'add-segment-group',
        ...file,
        segments: [{ value: 1, name: 'liver', color: rgba(1, 2, 3, 4) }],
      },
      context('parent')
    );
    expect(deps.segmentGroups.convertImageToLabelmap).toHaveBeenCalledTimes(1);
    expect(deps.segmentGroups.updateSegment).toHaveBeenCalledWith(
      'new-group',
      1,
      expect.anything()
    );
    expect(deps.segmentGroups.updateSegment).not.toHaveBeenCalledWith(
      'existing-group',
      expect.anything(),
      expect.anything()
    );
  });
});

describe('autoLoadProcessingResults', () => {
  it('routes every supported intent through the shared applier', async () => {
    deps.segmentGroups.convertImageToLabelmap.mockResolvedValue(['seg-group']);
    await autoLoad(
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
    expect(deps.segmentGroups.convertImageToLabelmap).toHaveBeenCalledTimes(1);
    expect(deps.segmentGroups.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      { providerId: 'p1', jobId: 'j1', outputId: 'seg' }
    );
    expect(deps.segmentGroups.updateSegment).toHaveBeenCalledTimes(1);
    expect(deps.openVolumeUrls).toHaveBeenCalledTimes(1);
    expect(deps.openVolumeUrls).toHaveBeenCalledWith({
      urls: [file.url],
      names: [file.name],
    });
    expect(deps.addLayer).toHaveBeenCalledWith('parent', 'child-selection');
  });

  it('does not auto-apply an unknown intent', async () => {
    await autoLoad([result({ intent: 'add-polygon' })], context('parent'));
    expect(deps.segmentGroups.convertImageToLabelmap).not.toHaveBeenCalled();
    expect(deps.openVolumeUrls).not.toHaveBeenCalled();
  });

  it('opens base images even when there is no originating dataset', async () => {
    await autoLoad([result({ intent: 'add-base-image' })], context(undefined));
    expect(deps.openVolumeUrls).toHaveBeenCalledWith({
      urls: [file.url],
      names: [file.name],
    });
    expect(deps.segmentGroups.convertImageToLabelmap).not.toHaveBeenCalled();
  });

  it('opens a parentless segment-group result as an ordinary dataset', async () => {
    await autoLoad(
      [result({ intent: 'add-segment-group' })],
      context(undefined)
    );
    expect(deps.segmentGroups.convertImageToLabelmap).not.toHaveBeenCalled();
    expect(deps.openVolumeUrls).toHaveBeenCalledWith({
      urls: [file.url],
      names: [file.name],
    });
  });

  it('keeps applying after one segment-group result throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    deps.segmentGroups.convertImageToLabelmap
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(['g2']);
    const application = await autoLoad(
      [
        result({ id: 'a', intent: 'add-segment-group' }),
        result({ id: 'b', intent: 'add-segment-group' }),
      ],
      context('parent')
    );
    expect(deps.segmentGroups.convertImageToLabelmap).toHaveBeenCalledTimes(2);
    expect(err).toHaveBeenCalled();
    expect(application.failedResultIds).toEqual(['a']);
  });

  it('reports success when every known intent applies', async () => {
    const application = await autoLoad(
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
    deps.segmentGroups.resultSourcesInScene.mockReturnValue([restoredSource]);

    const application = await autoLoad(
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
    expect(deps.importVolume).toHaveBeenCalledTimes(1);
    expect(deps.segmentGroups.convertImageToLabelmap).toHaveBeenCalledTimes(1);
    expect(deps.segmentGroups.convertImageToLabelmap).toHaveBeenCalledWith(
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
    deps.segmentGroups.convertImageToLabelmap.mockResolvedValue(['seg-group']);
    await autoLoad([segResult()], context('parent'));
    expect(deps.segmentGroups.convertImageToLabelmap).toHaveBeenCalledTimes(1);
  });

  it('lets the conversion path decide whether an imported labelmap can attach', async () => {
    await autoLoad([segResult()], context('parent'));
    expect(deps.segmentGroups.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      undefined
    );
  });

  it('does not auto-apply a result that fails to decode, and surfaces the failure', async () => {
    deps.importVolume.mockResolvedValue(null);
    await autoLoad([segResult()], context('parent'));
    expect(deps.segmentGroups.convertImageToLabelmap).not.toHaveBeenCalled();
    expect(errorMessages()).toHaveLength(1);
  });
});

describe('autoLoadProcessingResults — born-persistent (no confirm gate)', () => {
  it('applies the group immediately with no confirm gate', async () => {
    const source = { providerId: 'p1', jobId: 'j1', outputId: 'seg' };
    deps.segmentGroups.convertImageToLabelmap.mockResolvedValue(['seg-group']);
    await autoLoad(
      [result({ id: 'seg', intent: 'add-segment-group', source })],
      context('parent')
    );
    expect(deps.segmentGroups.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      source
    );
  });
});
