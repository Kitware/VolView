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

/**
 * What a conversion reports back: the segment each SOURCE label value became.
 * Colliding values are remapped as the import lands, so the source value is the
 * only handle a descriptor can match on.
 */
const importedComponent = (bySourceValue: Record<number, string>) =>
  Object.entries(bySourceValue).map(([sourceValue, maskId]) => ({
    sourceValue: Number(sourceValue),
    maskId,
  }));

const recordingDependencies = () => ({
  fetchResult: vi.fn(),
  openVolumeUrls: vi.fn(async () => ['dataset-live']),
  importVolume: vi.fn(async (): Promise<string | null> => 'child-selection'),
  removeDataset: vi.fn(),
  addLayer: vi.fn(async (): Promise<string | undefined> => 'layer-1'),
  segmentWriter: {
    resultSourcesInScene: vi.fn((): Array<ResultSource | undefined> => []),
    convertImageToLabelmap: vi.fn(async () => [
      importedComponent({ 1: 'segment-1', 2: 'segment-2' }),
    ]),
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
    expect(deps.segmentWriter.convertImageToLabelmap).not.toHaveBeenCalled();
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

  it('passes explicit descriptors into labelmap conversion', async () => {
    const segments = [
      { value: 1, name: 'liver', color: rgba(255, 0, 0, 255) },
      { value: 2, name: 'tumor', color: rgba(0, 255, 0, 255), visible: false },
    ];
    await apply(
      { intent: 'add-segment-group', ...file, segments },
      context('parent')
    );
    expect(deps.segmentWriter.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      undefined,
      segments
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
      deps.segmentWriter.convertImageToLabelmap.mock.invocationCallOrder[0]
    );
  });

  it('add-segment-group removes the imported child even when conversion fails', async () => {
    deps.segmentWriter.convertImageToLabelmap.mockRejectedValue(
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
    expect(deps.segmentWriter.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      undefined,
      undefined
    );
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
    expect(deps.segmentWriter.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      source,
      undefined
    );
  });

  it('treats a restored segment-group result as already applied', async () => {
    const source = {
      providerId: 'p1',
      jobId: 'job-abc123',
      outputId: 'outputLabelmap',
    };
    deps.segmentWriter.resultSourcesInScene.mockReturnValue([source]);

    const outcome = await apply(
      { intent: 'add-segment-group', ...file, source },
      context('parent')
    );

    expect(outcome.status).toBe('applied');
    expect(deps.importVolume).not.toHaveBeenCalled();
    expect(deps.segmentWriter.convertImageToLabelmap).not.toHaveBeenCalled();
    expect(deps.openVolumeUrls).not.toHaveBeenCalled();
  });

  type Source = { providerId: string; jobId: string; outputId: string };

  const expectAppliedBeside = async (inScene: Source, source: Source) => {
    deps.segmentWriter.resultSourcesInScene.mockReturnValue([inScene]);

    const outcome = await apply(
      { intent: 'add-segment-group', ...file, source },
      context('parent')
    );

    expect(outcome.status).toBe('applied');
    expect(deps.segmentWriter.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      source,
      undefined
    );
  };

  it('applies a different output from the same restored job', () =>
    expectAppliedBeside(
      { providerId: 'p1', jobId: 'job-abc123', outputId: 'existing-output' },
      { providerId: 'p1', jobId: 'job-abc123', outputId: 'new-output' }
    ));

  it('applies matching raw job and output ids from a different provider', () =>
    expectAppliedBeside(
      { providerId: 'provider-a', jobId: '1', outputId: 'seg' },
      { providerId: 'provider-b', jobId: '1', outputId: 'seg' }
    ));

  it('does not infer an application receipt when provenance is absent', async () => {
    deps.segmentWriter.resultSourcesInScene.mockReturnValue([undefined]);

    const outcome = await apply(
      { intent: 'add-segment-group', ...file },
      context('parent')
    );

    expect(outcome.status).toBe('applied');
    expect(deps.segmentWriter.convertImageToLabelmap).toHaveBeenCalledTimes(1);
  });

  it('add-segment-group with no originating dataset falls back to opening', async () => {
    await apply({ intent: 'add-segment-group', ...file }, context(undefined));
    expect(deps.segmentWriter.convertImageToLabelmap).not.toHaveBeenCalled();
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
    expect(deps.segmentWriter.convertImageToLabelmap).not.toHaveBeenCalled();
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
});

describe('autoLoadProcessingResults', () => {
  it('routes every supported intent through the shared applier', async () => {
    deps.segmentWriter.convertImageToLabelmap.mockResolvedValue([
      importedComponent({ 1: 'segment-1' }),
    ]);
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
    expect(deps.segmentWriter.convertImageToLabelmap).toHaveBeenCalledTimes(1);
    expect(deps.segmentWriter.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      { providerId: 'p1', jobId: 'j1', outputId: 'seg' },
      [{ value: 1, name: 'liver', color: rgba(1, 2, 3, 4) }]
    );
    expect(deps.openVolumeUrls).toHaveBeenCalledTimes(1);
    expect(deps.openVolumeUrls).toHaveBeenCalledWith({
      urls: [file.url],
      names: [file.name],
    });
    expect(deps.addLayer).toHaveBeenCalledWith('parent', 'child-selection');
  });

  it('does not auto-apply an unknown intent', async () => {
    await autoLoad([result({ intent: 'add-polygon' })], context('parent'));
    expect(deps.segmentWriter.convertImageToLabelmap).not.toHaveBeenCalled();
    expect(deps.openVolumeUrls).not.toHaveBeenCalled();
  });

  it('opens base images even when there is no originating dataset', async () => {
    await autoLoad([result({ intent: 'add-base-image' })], context(undefined));
    expect(deps.openVolumeUrls).toHaveBeenCalledWith({
      urls: [file.url],
      names: [file.name],
    });
    expect(deps.segmentWriter.convertImageToLabelmap).not.toHaveBeenCalled();
  });

  it('opens a parentless segment-group result as an ordinary dataset', async () => {
    await autoLoad(
      [result({ intent: 'add-segment-group' })],
      context(undefined)
    );
    expect(deps.segmentWriter.convertImageToLabelmap).not.toHaveBeenCalled();
    expect(deps.openVolumeUrls).toHaveBeenCalledWith({
      urls: [file.url],
      names: [file.name],
    });
  });

  it('keeps applying after one segment-group result throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    deps.segmentWriter.convertImageToLabelmap
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([importedComponent({ 1: 'segment-g2' })]);
    const application = await autoLoad(
      [
        result({ id: 'a', intent: 'add-segment-group' }),
        result({ id: 'b', intent: 'add-segment-group' }),
      ],
      context('parent')
    );
    expect(deps.segmentWriter.convertImageToLabelmap).toHaveBeenCalledTimes(2);
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
    deps.segmentWriter.resultSourcesInScene.mockReturnValue([restoredSource]);

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
    expect(deps.segmentWriter.convertImageToLabelmap).toHaveBeenCalledTimes(1);
    expect(deps.segmentWriter.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      newSource,
      undefined
    );
  });
});

describe('autoLoadProcessingResults — labelmap auto-apply', () => {
  const segResult = (overrides: Partial<ProcessingResult> = {}) =>
    result({ id: 'seg', intent: 'add-segment-group', ...overrides });

  it('auto-applies an importable labelmap', async () => {
    deps.segmentWriter.convertImageToLabelmap.mockResolvedValue([
      importedComponent({ 1: 'segment-1' }),
    ]);
    await autoLoad([segResult()], context('parent'));
    expect(deps.segmentWriter.convertImageToLabelmap).toHaveBeenCalledTimes(1);
  });

  it('lets the conversion path decide whether an imported labelmap can attach', async () => {
    await autoLoad([segResult()], context('parent'));
    expect(deps.segmentWriter.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      undefined,
      undefined
    );
  });

  it('does not auto-apply a result that fails to decode, and surfaces the failure', async () => {
    deps.importVolume.mockResolvedValue(null);
    await autoLoad([segResult()], context('parent'));
    expect(deps.segmentWriter.convertImageToLabelmap).not.toHaveBeenCalled();
    expect(errorMessages()).toHaveLength(1);
  });
});

describe('autoLoadProcessingResults — born-persistent (no confirm gate)', () => {
  it('applies the group immediately with no confirm gate', async () => {
    const source = { providerId: 'p1', jobId: 'j1', outputId: 'seg' };
    deps.segmentWriter.convertImageToLabelmap.mockResolvedValue([
      importedComponent({ 1: 'segment-1' }),
    ]);
    await autoLoad(
      [result({ id: 'seg', intent: 'add-segment-group', source })],
      context('parent')
    );
    expect(deps.segmentWriter.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      source,
      undefined
    );
  });
});
