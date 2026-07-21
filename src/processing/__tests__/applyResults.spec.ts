import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyIntent,
  autoLoadProcessingResults,
} from '@/src/processing/applyResults';
import type {
  ProcessingResult,
  SubmittedJobContext,
} from '@/src/processing/types';

// Mock every store / import boundary the applier touches so each test can
// assert exactly which store call an intent maps to. `vi.hoisted` lets the
// (hoisted) `vi.mock` factories share these spies.
const mocks = vi.hoisted(() => ({
  uriToDataSource: vi.fn(),
  importDataSources: vi.fn(),
  toDataSelection: vi.fn(),
  isVolumeResult: vi.fn(),
  loadUrls: vi.fn(),
  addLayer: vi.fn(),
  // Dataset-store removal of the temporary imported child (add-segment-group
  // must not leave its conversion vehicle in the Data panel).
  removeDataset: vi.fn(),
  convertImageToLabelmap: vi.fn(),
  updateSegment: vi.fn(),
  // The live-only "new job result" badge.
  markNew: vi.fn(),
  // Scene segment-group metadata, read by the durable job-history idempotency
  // guard. Keyed by group id; only `source` matters here.
  metadataByID: {} as Record<
    string,
    { source?: { jobId: string; outputId: string } }
  >,
  // Message center. applyIntent reports failure via its return value; callers own
  // any user-facing message, so these tests assert the applier never calls
  // addError.
  addError: vi.fn(),
}));

vi.mock('@/src/io/import/dataSource', () => ({
  uriToDataSource: mocks.uriToDataSource,
}));
vi.mock('@/src/io/import/importDataSources', () => ({
  importDataSources: mocks.importDataSources,
  toDataSelection: mocks.toDataSelection,
}));
vi.mock('@/src/io/import/common', () => ({
  isVolumeResult: mocks.isVolumeResult,
}));
vi.mock('@/src/actions/loadUserFiles', () => ({
  loadUrls: mocks.loadUrls,
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
vi.mock('@/src/processing/jobResultReview', () => ({
  useJobResultReviewStore: () => ({ markNew: mocks.markNew }),
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
  mocks.importDataSources.mockResolvedValue([
    { type: 'data', dataID: 'child-1' },
  ]);
  mocks.isVolumeResult.mockReturnValue(true);
  mocks.toDataSelection.mockReturnValue('child-selection');
  mocks.loadUrls.mockResolvedValue(['dataset-live']);
  // convertImageToLabelmap now returns the created group id(s); descriptors +
  // the badge key off the returned ids.
  mocks.convertImageToLabelmap.mockResolvedValue(['seg-group']);
  // addLayer resolves the built layer id on success; `undefined` means the
  // useErrorMessage wrapper swallowed a build failure.
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
    expect(mocks.loadUrls).toHaveBeenCalledWith({
      urls: [file.url],
      names: [file.name],
    });
    expect(mocks.addLayer).not.toHaveBeenCalled();
    expect(mocks.convertImageToLabelmap).not.toHaveBeenCalled();
  });

  it('restore-state opens the file (no dedicated session restore yet)', async () => {
    await applyIntent({ intent: 'restore-state', ...file }, context('parent'));
    expect(mocks.loadUrls).toHaveBeenCalledWith({
      urls: [file.url],
      names: [file.name],
    });
  });

  it('add-layer attaches a layer onto the originating dataset', async () => {
    const applied = await applyIntent(
      { intent: 'add-layer', ...file },
      context('parent')
    );
    expect(applied.status).toBe('applied');
    expect(mocks.addLayer).toHaveBeenCalledWith('parent', 'child-selection');
    expect(mocks.loadUrls).not.toHaveBeenCalled();
  });

  it('add-layer with no originating dataset falls back to opening', async () => {
    await applyIntent({ intent: 'add-layer', ...file }, context(undefined));
    expect(mocks.addLayer).not.toHaveBeenCalled();
    expect(mocks.loadUrls).toHaveBeenCalledWith({
      urls: [file.url],
      names: [file.name],
    });
  });

  it('add-segment-group converts the labelmap and applies descriptors to the created group', async () => {
    // Descriptors key off the id convertImageToLabelmap returns, not a racing
    // read of orderByParent.
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
    expect(mocks.loadUrls).not.toHaveBeenCalled();
  });

  it('add-segment-group removes the temporarily imported child dataset', async () => {
    // The import is only the conversion vehicle — the created group owns its
    // own derived labelmap image. Leaving the import behind would surface the
    // result BOTH as the segment group and as a Data-panel dataset, and
    // duplicate it into saved state (M-02).
    const outcome = await applyIntent(
      { intent: 'add-segment-group', ...file },
      context('parent')
    );
    expect(outcome.status).toBe('applied');
    expect(mocks.removeDataset).toHaveBeenCalledWith('child-selection');
    // Removal happens after the conversion consumed the child.
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
    // No folded sidecar -> the group keeps its own decoded segments.
    expect(mocks.updateSegment).not.toHaveBeenCalled();
  });

  it('stamps the source:{jobId,outputId} tag on the created group', async () => {
    const source = { jobId: 'job-abc123', outputId: 'outputLabelmap' };
    await applyIntent(
      { intent: 'add-segment-group', ...file, source },
      context('parent')
    );
    // The tag threads through convertImageToLabelmap -> addLabelmap so it
    // round-trips the .volview.zip (stamp + idempotency).
    expect(mocks.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      source
    );
  });

  it('add-segment-group with no originating dataset falls back to opening', async () => {
    await applyIntent(
      { intent: 'add-segment-group', ...file },
      context(undefined)
    );
    expect(mocks.convertImageToLabelmap).not.toHaveBeenCalled();
    expect(mocks.loadUrls).toHaveBeenCalledWith({
      urls: [file.url],
      names: [file.name],
    });
  });

  it('add-segment-group reports an explicit failure when the result fails to load (#7)', async () => {
    // loadAsImport returns null (404/corrupt/non-volume). applyIntent reports the
    // failure via its return value rather than messaging; JobList.dispatch owns
    // the toast so the same site also covers a THROWN apply failure.
    mocks.importDataSources.mockResolvedValue([]);
    const applied = await applyIntent(
      { intent: 'add-segment-group', ...file },
      context('parent')
    );
    expect(mocks.convertImageToLabelmap).not.toHaveBeenCalled();
    expect(applied.status).toBe('failed');
    expect(mocks.addError).not.toHaveBeenCalled();
  });

  it('add-layer reports an explicit failure when the result fails to load (#7)', async () => {
    mocks.importDataSources.mockResolvedValue([]);
    const applied = await applyIntent(
      { intent: 'add-layer', ...file },
      context('parent')
    );
    expect(mocks.addLayer).not.toHaveBeenCalled();
    expect(applied.status).toBe('failed');
    expect(mocks.addError).not.toHaveBeenCalled();
  });

  it('resolves to failed (never rejects) when the fallback open throws', async () => {
    // The openAsDataset fallback is `return await`ed inside applyIntent's try:
    // a rejected load (malformed URL, importer throw) must resolve to the
    // 'failed' outcome, not reject — JobList's dispatch has no catch.
    mocks.loadUrls.mockRejectedValue(new Error('bad result url'));
    const applied = await applyIntent(
      { intent: 'add-base-image', ...file },
      context('parent')
    );
    expect(applied.status).toBe('failed');
  });

  it('add-layer reports failure when the layer fails to build (addLayer swallows the throw)', async () => {
    // addLayer wraps _addLayer in useErrorMessage: a non-intersecting-bounds
    // build shows its own toast and resolves to `undefined`. The applier must
    // surface that as 'failed', not a false 'applied'.
    mocks.addLayer.mockResolvedValue(undefined);
    const applied = await applyIntent(
      { intent: 'add-layer', ...file },
      context('parent')
    );
    expect(mocks.addLayer).toHaveBeenCalledWith('parent', 'child-selection');
    expect(applied.status).toBe('failed');
    // With no layer referencing it, the imported child must not linger as an
    // unintended dataset (it would persist into saved state).
    expect(mocks.removeDataset).toHaveBeenCalledWith('child-selection');
    // The applier still owns no user message — addLayer already toasted.
    expect(mocks.addError).not.toHaveBeenCalled();
  });

  it('is additive-only: writes into the NEW group, never a pre-existing one', async () => {
    // A pre-existing group is present for the parent. Applying a segment-group
    // result must create a NEW group (convertImageToLabelmap) and apply
    // descriptors to it — never merge into the existing group.
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
    // Descriptors land on the freshly-created group, not the existing one.
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
          source: { jobId: 'j1', outputId: 'seg' },
          segments: [{ value: 1, name: 'liver', color: rgba(1, 2, 3, 4) }],
        }),
      ],
      context('parent')
    );
    expect(mocks.convertImageToLabelmap).toHaveBeenCalledTimes(1);
    expect(mocks.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      { jobId: 'j1', outputId: 'seg' }
    );
    expect(mocks.updateSegment).toHaveBeenCalledTimes(1);
    // The created group is badged as a new job result (born-persistent).
    expect(mocks.markNew).toHaveBeenCalledTimes(1);
    expect(mocks.markNew).toHaveBeenCalledWith('seg-group');
    expect(mocks.loadUrls).toHaveBeenCalledTimes(1);
    expect(mocks.loadUrls).toHaveBeenCalledWith({
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
    expect(mocks.markNew).not.toHaveBeenCalled();
    expect(mocks.loadUrls).not.toHaveBeenCalled();
  });

  it('opens base images even when there is no originating dataset', async () => {
    await autoLoadProcessingResults(
      [result({ intent: 'add-base-image' })],
      context(undefined)
    );
    expect(mocks.loadUrls).toHaveBeenCalledWith({
      urls: [file.url],
      names: [file.name],
    });
    expect(mocks.convertImageToLabelmap).not.toHaveBeenCalled();
    expect(mocks.markNew).not.toHaveBeenCalled();
  });

  it('opens a parentless segment-group result as an ordinary dataset', async () => {
    await autoLoadProcessingResults(
      [result({ intent: 'add-segment-group' })],
      context(undefined)
    );
    expect(mocks.convertImageToLabelmap).not.toHaveBeenCalled();
    expect(mocks.markNew).not.toHaveBeenCalled();
    expect(mocks.loadUrls).toHaveBeenCalledWith({
      urls: [file.url],
      names: [file.name],
    });
  });

  it('keeps applying after one segment-group result throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.convertImageToLabelmap
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(['g2']);
    await autoLoadProcessingResults(
      [
        result({ id: 'a', intent: 'add-segment-group' }),
        result({ id: 'b', intent: 'add-segment-group' }),
      ],
      context('parent')
    );
    expect(mocks.convertImageToLabelmap).toHaveBeenCalledTimes(2);
    expect(err).toHaveBeenCalled();
  });
});

describe('autoLoadProcessingResults — labelmap auto-apply', () => {
  const segResult = (overrides: Partial<ProcessingResult> = {}) =>
    result({ id: 'seg', intent: 'add-segment-group', ...overrides });

  it('auto-applies an importable labelmap and badges it new', async () => {
    mocks.convertImageToLabelmap.mockResolvedValue(['seg-group']);
    await autoLoadProcessingResults([segResult()], context('parent'));
    expect(mocks.convertImageToLabelmap).toHaveBeenCalledTimes(1);
    expect(mocks.markNew).toHaveBeenCalledWith('seg-group');
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
    // No importable volume -> loadAsImport returns null.
    mocks.importDataSources.mockResolvedValue([]);
    await autoLoadProcessingResults([segResult()], context('parent'));
    expect(mocks.convertImageToLabelmap).not.toHaveBeenCalled();
    expect(mocks.markNew).not.toHaveBeenCalled();
    // The completion toast said results were ready, so an auto-apply failure
    // must be surfaced, not swallowed to the console.
    expect(mocks.addError).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Born-persistent review model ("Review UX"): a
// validated result is a NORMAL, deletable segment group — no confirm/reject
// gate, no promotion state machine. The ONLY review surface is the live-only
// badge (markNew) + the existing visibility/delete UI.
// ---------------------------------------------------------------------------

describe('autoLoadProcessingResults — born-persistent (no confirm gate)', () => {
  it('applies the group immediately and its only review surface is the badge', async () => {
    const source = { jobId: 'j1', outputId: 'seg' };
    mocks.convertImageToLabelmap.mockResolvedValue(['seg-group']);
    await autoLoadProcessingResults(
      [result({ id: 'seg', intent: 'add-segment-group', source })],
      context('parent')
    );
    // The group is created straight away (born-persistent), stamped with source.
    expect(mocks.convertImageToLabelmap).toHaveBeenCalledWith(
      'child-selection',
      'parent',
      source
    );
    // The badge is the whole review surface — there is no confirm/promotion call
    // the applier could make beyond marking the group new.
    expect(mocks.markNew).toHaveBeenCalledTimes(1);
    expect(mocks.markNew).toHaveBeenCalledWith('seg-group');
  });
});
