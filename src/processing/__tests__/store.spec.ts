import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

import {
  useProcessingJobsStore,
  POLL_INTERVAL_MS,
  MAX_POLL_RETRIES,
} from '@/src/processing/store';
import { MessageType, useMessageStore } from '@/src/store/messages';
import type {
  ProcessingJobRef,
  ProcessingJobStatus,
  ProcessingProvider,
  ProcessingProviderConfig,
  ProcessingResult,
  TrackedJobRef,
} from '@/src/processing/types';
import { jobKey } from '@/src/processing/types';
import { jobHistoryFiltersBlocked } from '@/src/processing/engine/jobHistory';

// The store checks the dataset store to detect a base image deleted mid-job
// (item 8). Mock it to a controllable id list so the whole lifecycle suite stays
// hermetic (no real dataset subtree). `generateBugReport` — reached whenever the
// message store surfaces an error — only reads `idsAsSelections` from this store,
// so this mock also keeps that path working.
const { datasetState } = vi.hoisted(() => ({
  datasetState: {
    ids: [] as string[],
    // Provenance the durable job-history re-association reads (getDataSource → DataSource).
    sources: {} as Record<string, unknown>,
  },
}));
vi.mock('@/src/store/datasets', () => ({
  useDatasetStore: () => ({
    idsAsSelections: datasetState.ids,
    getDataSource: (id: string) => datasetState.sources[id],
  }),
}));

// The applier module, mocked so any store-side call would be assertable. The
// store must NEVER invoke it from re-discovery: a re-discovered terminal job
// is a job-history row the user applies explicitly, so the store must not
// auto-replay getResults — the adoption tests below pin `autoLoadMock`
// staying uncalled.
const { autoLoadMock } = vi.hoisted(() => ({ autoLoadMock: vi.fn() }));
vi.mock('@/src/processing/applyResults', () => ({
  autoLoadProcessingResults: autoLoadMock,
}));

// The lazily-imported provider factory. Mocked so the getProvider retry test can
// make `loadProvider` reject once then resolve. Every other test seeds
// `store.instances` directly, so this factory is only reached when a test calls
// `getProvider` with no preset instance.
const { createProviderMock } = vi.hoisted(() => ({
  createProviderMock: vi.fn(),
}));
vi.mock('@/src/processing/engine/createProvider', () => ({
  createProvider: createProviderMock,
}));

// Minimal fake provider — only the methods the lifecycle exercises are real.
const makeProvider = (
  overrides: Partial<ProcessingProvider>
): ProcessingProvider => ({
  config: {
    id: 'p1',
    label: 'Fake',
    baseUrl: 'http://localhost/',
    jobsBaseUrl: 'http://localhost/jobs',
  },
  listTasks: vi.fn().mockResolvedValue([]),
  getTaskSpec: vi.fn().mockResolvedValue({
    specVersion: 1,
    id: 't',
    title: 'T',
    parameters: [],
    outputs: [],
  }),
  runTask: vi.fn(),
  getJob: vi.fn(),
  getResults: vi.fn().mockResolvedValue(resultsBundle()),
  cancelJob: vi.fn().mockResolvedValue({
    jobId: 'x',
    state: 'cancelled',
    resultState: 'unavailable',
  }),
  stageInput: vi.fn().mockResolvedValue([]),
  // All operations are required on the transport now (no capability gating);
  // default them so every fake provider is a complete ProcessingProvider.
  deleteJob: vi.fn().mockResolvedValue(undefined),
  listJobHistory: vi.fn().mockResolvedValue({ jobs: [], nextCursor: null }),
  getJobHistoryDetail: vi.fn(),
  ...overrides,
});

const sampleResults: ProcessingResult[] = [
  { id: 'r1', name: 'out.nrrd', url: 'http://localhost/out.nrrd' },
];

const resultStateFor = (state: ProcessingJobStatus['state']) =>
  state === 'success'
    ? ('ready' as const)
    : state === 'error' || state === 'cancelled'
      ? ('unavailable' as const)
      : ('waiting' as const);

const jobStatus = (
  jobId: string,
  state: ProcessingJobStatus['state'],
  extra: Partial<ProcessingJobStatus> = {}
): ProcessingJobStatus => ({
  jobId,
  state,
  resultState: resultStateFor(state),
  ...extra,
});

// getResults now resolves the {results, missing} envelope bundle; wrap
// a plain result list for the mocks. `missing` defaults to 0 (a clean success).
const resultsBundle = (results: ProcessingResult[] = [], missing = 0) => ({
  results,
  missing,
});

// An error carrying an HTTP status, exactly as the engine transport throws
// (engine/transport.ts `HttpError`). The store's `classifyError` reads `.status`.
const httpError = (status: number, code?: string): Error => {
  const err = new Error(`Request failed: ${status}`) as Error & {
    status: number;
    code?: string;
  };
  err.status = status;
  err.code = code;
  return err;
};

// Every per-job collection is now keyed by `jobKey({ providerId, jobId })`, and
// every public action takes a `TrackedJobRef`. These helpers keep the tests
// terse: the single-provider suites all run on provider id 'p1'.
const ref = (jobId: string, providerId = 'p1'): TrackedJobRef => ({
  providerId,
  jobId,
});
const keyFor = (jobId: string, providerId = 'p1'): string =>
  jobKey(ref(jobId, providerId));

describe('Providers store — job lifecycle (async with sync fast-path)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    datasetState.ids = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('routes a born-terminal job through completion without scheduling a poller', async () => {
    const store = useProcessingJobsStore();

    const status = jobStatus('job-sync', 'success');
    const getJob = vi.fn();
    const getResults = vi.fn().mockResolvedValue(resultsBundle(sampleResults));
    const runTask = vi
      .fn()
      .mockResolvedValue({ jobId: 'job-sync', status } as ProcessingJobRef);
    const provider = makeProvider({ runTask, getJob, getResults });
    store.instances.set('p1', provider);

    const listener = vi.fn();
    store.onJobComplete(listener);

    const jobId = await store.submitJob('p1', 'task-1', {}, {});

    // Completion fired exactly once with the terminal status + fetched results.
    expect(jobId).toBe('job-sync');
    expect(getResults).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        status,
        results: sampleResults,
        context: expect.objectContaining({
          jobId: 'job-sync',
          taskId: 'task-1',
        }),
      })
    );
    expect(store.jobs.get(keyFor('job-sync'))?.state).toBe('success');
    expect(store.jobResults.get(keyFor('job-sync'))).toEqual(sampleResults);
    expect(
      useMessageStore().messages.filter((m) => m.type === MessageType.Success)
    ).toEqual([
      expect.objectContaining({
        title: 'Job complete: task-1',
        options: expect.objectContaining({
          details: '1 result available in the Jobs panel.',
        }),
      }),
    ]);

    // No poller: getJob is never called, even after intervals elapse.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(getJob).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('polls non-terminal jobs until terminal, then completes once', async () => {
    const store = useProcessingJobsStore();

    const getJob = vi
      .fn()
      .mockResolvedValueOnce(jobStatus('job-async', 'running'))
      .mockResolvedValue(jobStatus('job-async', 'success'));
    const getResults = vi.fn().mockResolvedValue(resultsBundle(sampleResults));
    // No `status` on the ref → store treats the job as pending and polls.
    const runTask = vi
      .fn()
      .mockResolvedValue({ jobId: 'job-async' } as ProcessingJobRef);
    const provider = makeProvider({ runTask, getJob, getResults });
    store.instances.set('p1', provider);

    const listener = vi.fn();
    store.onJobComplete(listener);

    await store.submitJob('p1', 'task-1', {}, {});

    // Immediate poll observed `running` — still polling, not complete.
    await vi.advanceTimersByTimeAsync(0);
    expect(getJob).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();

    // Next interval observes `success` → completion fires once.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(getJob).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        status: jobStatus('job-async', 'success'),
        results: sampleResults,
        context: expect.objectContaining({ jobId: 'job-async' }),
      })
    );

    // Poller stopped after terminal — no further getJob calls.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(getJob).toHaveBeenCalledTimes(2);
  });

  // Cancel (best-effort in the status/results contract): the cancel action is ONE neutral
  // engine call. It does not terminalize the job itself — the EXISTING poller
  // converges on whatever terminal state the backend reports, so `cancelled` is
  // never fabricated and completion still fires exactly once.
  it('cancel action fires one engine call; the poller converges on cancelled', async () => {
    const store = useProcessingJobsStore();

    const getJob = vi
      .fn()
      .mockResolvedValueOnce(jobStatus('job-cancel', 'running'))
      .mockResolvedValue(jobStatus('job-cancel', 'cancelled'));
    const getResults = vi.fn().mockResolvedValue(resultsBundle(sampleResults));
    const cancelJob = vi
      .fn()
      .mockResolvedValue(jobStatus('job-cancel', 'cancelled'));
    const runTask = vi
      .fn()
      .mockResolvedValue({ jobId: 'job-cancel' } as ProcessingJobRef);
    const provider = makeProvider({ runTask, getJob, getResults, cancelJob });
    store.instances.set('p1', provider);

    const listener = vi.fn();
    store.onJobComplete(listener);

    const jobId = await store.submitJob('p1', 'task-1', {}, {});
    await vi.advanceTimersByTimeAsync(0);
    expect(getJob).toHaveBeenCalledTimes(1);

    // The user cancels — one neutral engine call with the job id.
    await store.cancelJob(ref(jobId));
    expect(cancelJob).toHaveBeenCalledTimes(1);
    expect(cancelJob).toHaveBeenCalledWith('job-cancel');
    // Cancel itself did NOT complete the job — the poller is still the driver.
    expect(listener).not.toHaveBeenCalled();
    expect(store.jobs.get(keyFor('job-cancel'))?.state).toBe('running');

    // The existing poller observes the backend's terminal `cancelled`.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(store.jobs.get(keyFor('job-cancel'))?.state).toBe('cancelled');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        status: jobStatus('job-cancel', 'cancelled'),
        results: [],
        context: expect.objectContaining({ jobId: 'job-cancel' }),
      })
    );
    // A cancelled (non-success) terminal fetches no results.
    expect(getResults).not.toHaveBeenCalled();

    // Poller stopped after terminal.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(getJob).toHaveBeenCalledTimes(2);
  });

  // Fail closed: cancelling a job the store never tracked is a no-op that never
  // reaches a provider and never throws to the UI.
  it('cancel of an untracked job is a no-op', async () => {
    const store = useProcessingJobsStore();
    const cancelJob = vi.fn();
    store.instances.set('p1', makeProvider({ cancelJob }));

    await expect(store.cancelJob(ref('ghost'))).resolves.toBeUndefined();
    expect(cancelJob).not.toHaveBeenCalled();
  });

  // Best-effort: a failed cancel request is surfaced (not thrown), and the
  // poller keeps running so a job that terminates on its own still converges.
  it('surfaces a cancel failure without throwing and keeps polling', async () => {
    const store = useProcessingJobsStore();

    const getJob = vi.fn().mockResolvedValue(jobStatus('job-cf', 'running'));
    const cancelJob = vi.fn().mockRejectedValue(httpError(500));
    const runTask = vi
      .fn()
      .mockResolvedValue({ jobId: 'job-cf' } as ProcessingJobRef);
    store.instances.set('p1', makeProvider({ runTask, getJob, cancelJob }));

    const jobId = await store.submitJob('p1', 'task-1', {}, {});
    await vi.advanceTimersByTimeAsync(0);

    await expect(store.cancelJob(ref(jobId))).resolves.toBeUndefined();

    const errs = useMessageStore().messages.filter(
      (m) => m.type === MessageType.Error
    );
    expect(errs.some((m) => /cancel/i.test(m.title))).toBe(true);
    // Poller is untouched — the job is still tracked and polling.
    expect(store.jobs.get(keyFor('job-cf'))?.state).toBe('running');
  });

  // An adapter that meets a malformed wire status returns an `error` job state
  // (item 4.3). `error` is terminal, so the poller must stop rather than loop
  // forever, and completion fires with no results (state is not `success`).
  it('stops polling and completes with no results when a job errors', async () => {
    const store = useProcessingJobsStore();

    const getJob = vi
      .fn()
      .mockResolvedValueOnce(jobStatus('job-err', 'running'))
      .mockResolvedValue(jobStatus('job-err', 'error', { errorTail: 'boom' }));
    const getResults = vi.fn().mockResolvedValue(resultsBundle(sampleResults));
    const runTask = vi
      .fn()
      .mockResolvedValue({ jobId: 'job-err' } as ProcessingJobRef);
    const provider = makeProvider({ runTask, getJob, getResults });
    store.instances.set('p1', provider);

    const listener = vi.fn();
    store.onJobComplete(listener);

    await store.submitJob('p1', 'task-1', {}, {});

    await vi.advanceTimersByTimeAsync(0); // running — still polling
    expect(listener).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); // error — terminal
    expect(getJob).toHaveBeenCalledTimes(2);
    expect(store.jobs.get(keyFor('job-err'))?.state).toBe('error');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        status: expect.objectContaining({ jobId: 'job-err', state: 'error' }),
        results: [],
        context: expect.objectContaining({ jobId: 'job-err' }),
      })
    );
    expect(
      useMessageStore().messages.filter((m) => m.type === MessageType.Error)
    ).toEqual([
      expect.objectContaining({
        title: 'Job failed: task-1',
        options: expect.objectContaining({ details: 'boom' }),
      }),
    ]);
    expect(getResults).not.toHaveBeenCalled();

    // Poller stopped — no further polls no matter how much time elapses.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(getJob).toHaveBeenCalledTimes(2);
  });

  // The born-terminal fast-path equivalent: a malformed born-terminal ref is
  // validated to an `error` status at the adapter seam, so the store routes it
  // through completion once and never registers a poller (no infinite poll).
  it('routes a born-terminal error ref through completion without polling', async () => {
    const store = useProcessingJobsStore();

    const status = jobStatus('job-born-err', 'error', {
      errorTail: 'malformed',
    });
    const getJob = vi.fn();
    const getResults = vi.fn().mockResolvedValue(resultsBundle(sampleResults));
    const runTask = vi
      .fn()
      .mockResolvedValue({ jobId: 'job-born-err', status } as ProcessingJobRef);
    const provider = makeProvider({ runTask, getJob, getResults });
    store.instances.set('p1', provider);

    const listener = vi.fn();
    store.onJobComplete(listener);

    const jobId = await store.submitJob('p1', 'task-1', {}, {});

    expect(jobId).toBe('job-born-err');
    expect(store.jobs.get(keyFor('job-born-err'))?.state).toBe('error');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        status: expect.objectContaining({
          jobId: 'job-born-err',
          state: 'error',
        }),
        results: [],
        context: expect.objectContaining({ jobId: 'job-born-err' }),
      })
    );
    expect(
      useMessageStore().messages.filter((m) => m.type === MessageType.Error)
    ).toEqual([
      expect.objectContaining({
        title: 'Job failed: task-1',
        options: expect.objectContaining({ details: 'malformed' }),
      }),
    ]);
    expect(getResults).not.toHaveBeenCalled();

    // No poller registered — getJob never called even after intervals elapse.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(getJob).not.toHaveBeenCalled();
  });

  it('surfaces a clear fallback when a job error has no backend details', async () => {
    const store = useProcessingJobsStore();

    const status = jobStatus('job-no-detail', 'error');
    const runTask = vi.fn().mockResolvedValue({
      jobId: 'job-no-detail',
      status,
    } as ProcessingJobRef);
    const provider = makeProvider({
      runTask,
      getJob: vi.fn(),
      getResults: vi.fn(),
    });
    store.instances.set('p1', provider);

    await store.submitJob('p1', 'task-1', {}, {});

    expect(
      useMessageStore().messages.filter((m) => m.type === MessageType.Error)
    ).toEqual([
      expect.objectContaining({
        title: 'Job failed: task-1',
        options: expect.objectContaining({
          details: expect.stringContaining('did not include error details'),
        }),
      }),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Live-only durability + failure UX.
//
// Each of the seven PLAN "Job-tracking failure UX" behaviors gets an explicit
// case; the marquee case is the tab-switch replay (unmount → terminal event →
// remount → exactly one replay).
// ---------------------------------------------------------------------------

describe('Providers store — live-only durability + failure UX', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    datasetState.ids = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const errorMessages = () =>
    useMessageStore().messages.filter((m) => m.type === MessageType.Error);
  const warningMessages = () =>
    useMessageStore().messages.filter((m) => m.type === MessageType.Warning);

  // Item 1 — the durability acceptance: a job that finishes while the Jobs tab
  // is unmounted (no listener) replays into a fresh subscription EXACTLY ONCE.
  it('replays a terminal completion to a listener that subscribes after the event (tab-switch replay, item 1)', async () => {
    const store = useProcessingJobsStore();

    const status = jobStatus('job-replay', 'success');
    const getJob = vi.fn();
    const getResults = vi.fn().mockResolvedValue(resultsBundle(sampleResults));
    const runTask = vi
      .fn()
      .mockResolvedValue({ jobId: 'job-replay', status } as ProcessingJobRef);
    const provider = makeProvider({ runTask, getJob, getResults });
    store.instances.set('p1', provider);

    // Job finishes with NO listener subscribed (Jobs tab unmounted). The records
    // survive the unmount (JobList would still render it on remount).
    await store.submitJob('p1', 'task-1', {}, {});
    expect(store.jobs.get(keyFor('job-replay'))?.state).toBe('success');
    expect(store.jobResults.get(keyFor('job-replay'))).toEqual(sampleResults);

    // Remount: subscribe now → the completion replays exactly once.
    const listener = vi.fn();
    const unsubscribe = store.onJobComplete(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ status, results: sampleResults })
    );

    // Unmount, then remount with a FRESH callback (as the component does each
    // mount): the already-delivered completion is NOT replayed a second time.
    unsubscribe();
    const listener2 = vi.fn();
    store.onJobComplete(listener2);
    expect(listener2).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  // Item 3 — the poll loop bounds transient retries with exponential backoff and
  // then fails the job loud; it never loops quietly forever.
  it('bounds transient poll retries with backoff, then fails the job loud (item 3)', async () => {
    const store = useProcessingJobsStore();

    // No HTTP status → a network blip → transient (retryable).
    const getJob = vi.fn().mockRejectedValue(new Error('network blip'));
    const runTask = vi
      .fn()
      .mockResolvedValue({ jobId: 'job-flaky' } as ProcessingJobRef);
    const provider = makeProvider({ runTask, getJob });
    store.instances.set('p1', provider);

    const listener = vi.fn();
    store.onJobComplete(listener);

    await store.submitJob('p1', 'task-1', {}, {});

    // The immediate poll failed once. Backoff means the next retry is NOT at the
    // base interval — advancing one base interval fires no second poll.
    await vi.advanceTimersByTimeAsync(0);
    expect(getJob).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(getJob).toHaveBeenCalledTimes(1);

    // Drive the bounded retries to exhaustion.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    // Bounded: exactly MAX_POLL_RETRIES retries after the first attempt.
    expect(getJob).toHaveBeenCalledTimes(MAX_POLL_RETRIES + 1);
    // Failed loud: the job is errored and surfaced (never a quiet infinite loop).
    expect(store.jobs.get(keyFor('job-flaky'))?.state).toBe('error');
    expect(errorMessages().length).toBeGreaterThan(0);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        status: expect.objectContaining({ state: 'error' }),
        results: [],
      })
    );

    // The loop is truly stopped — no further polling.
    const settled = getJob.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(getJob).toHaveBeenCalledTimes(settled);
  });

  // Item 3 (permanent branch) — a 4xx is not transient: no retry, fail at once.
  it('fails a job immediately on a permanent poll error, without retrying (item 3)', async () => {
    const store = useProcessingJobsStore();

    const getJob = vi.fn().mockRejectedValue(httpError(400));
    const runTask = vi
      .fn()
      .mockResolvedValue({ jobId: 'job-bad' } as ProcessingJobRef);
    const provider = makeProvider({ runTask, getJob });
    store.instances.set('p1', provider);

    await store.submitJob('p1', 'task-1', {}, {});
    await vi.advanceTimersByTimeAsync(0);

    expect(getJob).toHaveBeenCalledTimes(1);
    expect(store.jobs.get(keyFor('job-bad'))?.state).toBe('error');
    expect(errorMessages().length).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(getJob).toHaveBeenCalledTimes(1); // never retried
  });

  // Item 4 — a submit failure is surfaced in the UI (message center), not
  // swallowed to a console.error.
  it('surfaces a submit failure in the message center instead of swallowing it (item 4)', async () => {
    const store = useProcessingJobsStore();

    const runTask = vi.fn().mockRejectedValue(new Error('submit exploded'));
    const provider = makeProvider({ runTask });
    store.instances.set('p1', provider);

    await expect(store.submitJob('p1', 'task-1', {}, {})).rejects.toThrow(
      'submit exploded'
    );

    const errs = errorMessages();
    expect(errs.length).toBe(1);
    expect(errs[0].title).toMatch(/submit/i);
  });

  // Item 5 — result reads gate on success AND a results-fetch error is an ERROR,
  // never empty results (the old `notify([])` conflated failure with empty).
  it('treats a results-fetch error as an error, never empty results (item 5)', async () => {
    const store = useProcessingJobsStore();

    const status = jobStatus('job-fetch-fail', 'success');
    const getResults = vi.fn().mockRejectedValue(new Error('results 500'));
    const runTask = vi.fn().mockResolvedValue({
      jobId: 'job-fetch-fail',
      status,
    } as ProcessingJobRef);
    const provider = makeProvider({ runTask, getResults, getJob: vi.fn() });
    store.instances.set('p1', provider);

    const listener = vi.fn();
    store.onJobComplete(listener);

    await store.submitJob('p1', 'task-1', {}, {});

    // The gate opened on success, so results were attempted...
    expect(getResults).toHaveBeenCalledTimes(1);
    // ...but the failure became an ERROR, not an empty-results success.
    expect(store.jobs.get(keyFor('job-fetch-fail'))?.state).toBe('error');
    expect(store.jobResults.get(keyFor('job-fetch-fail'))).toBeUndefined();
    expect(errorMessages().some((m) => /result/i.test(m.title))).toBe(true);

    expect(listener).toHaveBeenCalledTimes(1);
    const completion = listener.mock.calls[0][0];
    expect(completion.status.state).toBe('error');
    expect(completion.results).toEqual([]);
  });

  // Item 6 — timers are stopped and job records dropped on clear (no leak of an
  // in-flight poller or stale record on a provider reset).
  it('stops timers and drops job records on clear (item 6)', async () => {
    const store = useProcessingJobsStore();

    // A running (non-terminal) job → a live poll timer to leak.
    const getJob = vi.fn().mockResolvedValue(jobStatus('job-live', 'running'));
    const runTask = vi
      .fn()
      .mockResolvedValue({ jobId: 'job-live' } as ProcessingJobRef);
    const provider = makeProvider({ runTask, getJob });
    store.instances.set('p1', provider);

    await store.submitJob('p1', 'task-1', {}, {});
    await vi.advanceTimersByTimeAsync(0);
    expect(store.jobs.size).toBe(1);
    const polledBeforeClear = getJob.mock.calls.length;

    // Clear → records dropped AND the poll timer stopped.
    store.clearProviders();
    expect(store.jobs.size).toBe(0);
    expect(store.jobResults.size).toBe(0);
    expect(store.submittedContexts.size).toBe(0);

    // Timer really stopped — no more polling after the clear.
    await vi.advanceTimersByTimeAsync(10 * POLL_INTERVAL_MS);
    expect(getJob).toHaveBeenCalledTimes(polledBeforeClear);
  });

  // Item 6 (single-job parity) — deleteJob must tear down the SAME completion
  // bookkeeping clearJobs does (terminalCompletions / firedCompletions /
  // inFlightCompletions). Otherwise a deleted job's stale markers linger for the
  // session and suppress the SAME jobId if it recurs: the guard in fireCompletion
  // sees terminalCompletions/firedCompletions still holding the id and early-returns,
  // so the recycled job never fires its side effects again.
  it('deleteJob clears completion bookkeeping so a recycled jobId completes again', async () => {
    const store = useProcessingJobsStore();

    // Born-terminal success → completion runs synchronously through the same
    // path as a polled job, populating terminalCompletions + firedCompletions.
    const status = jobStatus('job-recycle', 'success');
    const getResults = vi.fn().mockResolvedValue(resultsBundle(sampleResults));
    const runTask = vi
      .fn()
      .mockResolvedValue({ jobId: 'job-recycle', status } as ProcessingJobRef);
    const deleteJob = vi.fn().mockResolvedValue(undefined);
    const provider = makeProvider({
      runTask,
      getJob: vi.fn(),
      getResults,
      deleteJob,
    });
    store.instances.set('p1', provider);

    const listener = vi.fn();
    store.onJobComplete(listener);

    // First run of this jobId: completion fires exactly once.
    const jobId = await store.submitJob('p1', 'task-1', {}, {});
    expect(jobId).toBe('job-recycle');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getResults).toHaveBeenCalledTimes(1);

    // Delete the job — the provider delete is invoked and the store's records +
    // completion bookkeeping for this id are torn down.
    await store.deleteJob(ref('job-recycle'));
    expect(deleteJob).toHaveBeenCalledWith('job-recycle');
    expect(store.jobs.has(keyFor('job-recycle'))).toBe(false);
    expect(store.submittedContexts.has(keyFor('job-recycle'))).toBe(false);

    // Re-submit the SAME jobId: with the stale terminalCompletions/firedCompletions
    // marker cleared, it is treated as fresh and the completion fires AGAIN — it is
    // NOT suppressed as already-delivered.
    await store.submitJob('p1', 'task-1', {}, {});
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getResults).toHaveBeenCalledTimes(2);
    expect(store.jobs.get(keyFor('job-recycle'))?.state).toBe('success');
  });

  // Item 7 — a 401/403 mid-job means the whole same-origin session is dead:
  // flag it (so the UI prompts a reload), surface a persistent message, and stop
  // all polling.
  it('marks the session expired and stops all polling on a 401 mid-job (item 7)', async () => {
    const store = useProcessingJobsStore();

    const getJob = vi.fn().mockRejectedValue(httpError(401));
    const runTask = vi
      .fn()
      .mockResolvedValue({ jobId: 'job-401' } as ProcessingJobRef);
    const provider = makeProvider({ runTask, getJob });
    store.instances.set('p1', provider);

    await store.submitJob('p1', 'task-1', {}, {});
    await vi.advanceTimersByTimeAsync(0);

    expect(store.sessionExpired).toBe(true);
    const expiry = errorMessages().find((m) =>
      /session has expired/i.test(m.title)
    );
    expect(expiry).toBeDefined();
    expect(expiry?.options.persist).toBe(true);

    // No retry storm on a dead session — polling stopped entirely.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(getJob).toHaveBeenCalledTimes(1);
  });

  // Item 8 — the originating base image was removed mid-job: detect + message,
  // and the result is NOT silently dropped (it stays in the Jobs panel).
  it('detects a base image deleted mid-job and messages without dropping the result (item 8)', async () => {
    datasetState.ids = []; // the originating dataset is gone
    const store = useProcessingJobsStore();

    const status = jobStatus('job-orphan', 'success');
    const getResults = vi.fn().mockResolvedValue(resultsBundle(sampleResults));
    const runTask = vi.fn().mockResolvedValue({
      jobId: 'job-orphan',
      status,
    } as ProcessingJobRef);
    const provider = makeProvider({ runTask, getResults, getJob: vi.fn() });
    store.instances.set('p1', provider);

    const listener = vi.fn();
    store.onJobComplete(listener);

    // Submitted against a dataset that is no longer loaded at completion time.
    await store.submitJob(
      'p1',
      'task-1',
      {},
      { activeDatasetId: 'ds-removed' }
    );

    // Detected + messaged (a warning)...
    expect(warningMessages().some((m) => /base image/i.test(m.title))).toBe(
      true
    );
    // ...and the result is retained, not silently dropped.
    expect(store.jobResults.get(keyFor('job-orphan'))).toEqual(sampleResults);
    const completion = listener.mock.calls[0][0];
    expect(completion.baseImageMissing).toBe(true);
    expect(completion.results).toEqual(sampleResults);
  });

  // Item 8 (no false positive) — when the base image is still loaded, no
  // deleted-base warning fires and the completion is a normal auto-attach.
  it('does not flag a missing base image when the originating dataset is still loaded (item 8)', async () => {
    datasetState.ids = ['ds-present'];
    const store = useProcessingJobsStore();

    const status = jobStatus('job-ok', 'success');
    const getResults = vi.fn().mockResolvedValue(resultsBundle(sampleResults));
    const runTask = vi
      .fn()
      .mockResolvedValue({ jobId: 'job-ok', status } as ProcessingJobRef);
    const provider = makeProvider({ runTask, getResults, getJob: vi.fn() });
    store.instances.set('p1', provider);

    const listener = vi.fn();
    store.onJobComplete(listener);

    await store.submitJob(
      'p1',
      'task-1',
      {},
      { activeDatasetId: 'ds-present' }
    );

    expect(warningMessages().some((m) => /base image/i.test(m.title))).toBe(
      false
    );
    const completion = listener.mock.calls[0][0];
    expect(completion.baseImageMissing).toBeFalsy();
    expect(completion.results).toEqual(sampleResults);
  });

  // The backend could not resolve some recorded outputs (deleted /
  // unreadable): a non-zero `missing` on a SUCCESS is a partial loss. Surface a
  // warning that names the count WITHOUT dropping the results that resolved.
  it('surfaces a partial-loss warning on a non-zero missing count, still applying the results', async () => {
    datasetState.ids = ['ds-present'];
    const store = useProcessingJobsStore();

    const status = jobStatus('job-miss', 'success', {
      resultState: 'incomplete',
    });
    // Two outputs were recorded; the backend could resolve only one.
    const getResults = vi
      .fn()
      .mockResolvedValue(resultsBundle(sampleResults, 2));
    const runTask = vi
      .fn()
      .mockResolvedValue({ jobId: 'job-miss', status } as ProcessingJobRef);
    const provider = makeProvider({ runTask, getResults, getJob: vi.fn() });
    store.instances.set('p1', provider);

    const listener = vi.fn();
    store.onJobComplete(listener);

    await store.submitJob(
      'p1',
      'task-1',
      {},
      { activeDatasetId: 'ds-present' }
    );

    // A warning naming the count is surfaced...
    const warning = warningMessages().find((m) =>
      /could not be retrieved/i.test(m.title)
    );
    expect(warning).toBeTruthy();
    expect(warning?.title).toContain('2');
    // ...and the results that DID resolve are still recorded + delivered.
    expect(store.jobResults.get(keyFor('job-miss'))).toEqual(sampleResults);
    expect(listener.mock.calls[0][0].results).toEqual(sampleResults);
  });

  // No false positive: a clean success (missing 0) surfaces NO output-loss warning.
  it('surfaces no partial-loss warning when nothing is missing', async () => {
    datasetState.ids = ['ds-present'];
    const store = useProcessingJobsStore();

    const status = jobStatus('job-clean', 'success');
    const getResults = vi
      .fn()
      .mockResolvedValue(resultsBundle(sampleResults, 0));
    const runTask = vi
      .fn()
      .mockResolvedValue({ jobId: 'job-clean', status } as ProcessingJobRef);
    const provider = makeProvider({ runTask, getResults, getJob: vi.fn() });
    store.instances.set('p1', provider);
    store.onJobComplete(vi.fn());

    await store.submitJob(
      'p1',
      'task-1',
      {},
      { activeDatasetId: 'ds-present' }
    );

    expect(
      warningMessages().some((m) => /could not be retrieved/i.test(m.title))
    ).toBe(false);
  });
});

describe('Providers store — re-discovered job history: slim observability adoption', () => {
  const config = {
    id: 'p1',
    label: 'Fake',
    baseUrl: 'http://localhost/',
    jobsBaseUrl: 'http://localhost/jobs',
  };

  const handle = (overrides: Record<string, unknown> = {}) => {
    const state = (overrides.state ??
      'success') as ProcessingJobStatus['state'];
    return {
      jobId: 'jr',
      taskId: 't1',
      taskTitle: 'Task one',
      createdBy: { id: 'u1', name: 'User One' },
      createdAt: '2026-07-03T19:00:00Z',
      finishedAt: '2026-07-03T20:00:00Z',
      state,
      resultState: resultStateFor(state),
      outputSummary: { recorded: 0, missing: 0 },
      ...overrides,
    };
  };

  // Register a provider config + preset its instance so getProvider returns the
  // fake (no dynamic import), and give the reloaded scene one server dataset
  // whose provenance is the job's input URI.
  const arrange = (provider: ProcessingProvider) => {
    const store = useProcessingJobsStore();
    store.registerProviderConfig(config);
    store.instances.set('p1', provider);
    datasetState.ids = ['ds1'];
    datasetState.sources = { ds1: { type: 'uri', uri: '/f/a' } };
    return store;
  };

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    datasetState.ids = [];
    datasetState.sources = {};
    autoLoadMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('an empty job history adopts nothing (no re-discovery, no apply)', async () => {
    // listJobHistory is always present now; an empty page adopts nothing.
    const provider = makeProvider({
      getJob: vi.fn(),
      getResults: vi.fn(),
      listJobHistory: vi.fn().mockResolvedValue({ jobs: [], nextCursor: null }),
    });
    const store = arrange(provider);

    await store.adoptJobHistory();

    expect(provider.getJob).not.toHaveBeenCalled();
    expect(autoLoadMock).not.toHaveBeenCalled();
    expect(store.submittedContexts.size).toBe(0);
  });

  it('Load more traverses every page and filtering can await completeness', async () => {
    const second = handle({ jobId: 'jr-2', createdAt: '2026-06-01T00:00:00Z' });
    const listJobHistory = vi
      .fn()
      .mockResolvedValueOnce({ jobs: [handle()], nextCursor: 'page-2' })
      .mockResolvedValueOnce({ jobs: [second], nextCursor: null });
    const provider = makeProvider({ listJobHistory });
    const store = arrange(provider);

    await store.adoptJobHistory();
    expect(store.jobHistoryComplete).toBe(false);
    expect(store.jobHistory.size).toBe(1);

    await store.loadAllJobHistory();
    expect(listJobHistory).toHaveBeenNthCalledWith(1, undefined);
    expect(listJobHistory).toHaveBeenNthCalledWith(2, 'page-2');
    expect(store.jobHistoryComplete).toBe(true);
    expect([...store.jobHistory.keys()]).toEqual([
      keyFor('jr'),
      keyFor('jr-2'),
    ]);
  });

  it('preserves a failed continuation for retry and never completes partial history', async () => {
    const second = handle({ jobId: 'jr-2', createdAt: '2026-06-01T00:00:00Z' });
    const listJobHistory = vi
      .fn()
      .mockResolvedValueOnce({ jobs: [handle()], nextCursor: 'page-2' })
      .mockRejectedValueOnce(new Error('temporary page failure'))
      .mockResolvedValueOnce({ jobs: [second], nextCursor: null });
    const store = arrange(makeProvider({ listJobHistory }));

    await store.adoptJobHistory();
    await store.loadMoreJobHistory();

    expect(store.jobHistory.size).toBe(1);
    expect(store.jobHistoryComplete).toBe(false);
    expect(store.jobHistoryError).toContain('temporary page failure');
    expect(jobHistoryFiltersBlocked(true, store.jobHistoryComplete)).toBe(true);

    await Promise.all([store.loadMoreJobHistory(), store.loadMoreJobHistory()]);
    expect(listJobHistory).toHaveBeenCalledTimes(3);
    expect(listJobHistory).toHaveBeenNthCalledWith(3, 'page-2');
    expect(store.jobHistoryComplete).toBe(true);
    expect(jobHistoryFiltersBlocked(true, store.jobHistoryComplete)).toBe(
      false
    );
    expect(store.jobHistoryError).toBeNull();
    expect([...store.jobHistory.keys()]).toEqual([
      keyFor('jr'),
      keyFor('jr-2'),
    ]);
  });

  it('keeps an initial history failure retryable instead of treating it as empty', async () => {
    const listJobHistory = vi
      .fn()
      .mockRejectedValueOnce(new Error('initial failure'))
      .mockResolvedValueOnce({ jobs: [handle()], nextCursor: null });
    const store = arrange(makeProvider({ listJobHistory }));

    await store.adoptJobHistory();
    expect(store.jobHistoryComplete).toBe(false);
    expect(store.jobHistoryError).toContain('initial failure');

    await store.loadMoreJobHistory();
    expect(store.jobHistoryComplete).toBe(true);
    expect(store.jobHistory.size).toBe(1);
  });

  // The deletion pin: a terminal re-discovered job is a Jobs-panel
  // observability row ONLY. A re-discovered terminal job is a job-history row
  // the user applies explicitly — the client never replays getResults.
  it('a terminal-success handle becomes an observability row — never getResults, never auto-load', async () => {
    const provider = makeProvider({
      listJobHistory: vi.fn().mockResolvedValue({
        jobs: [handle({ state: 'success' })],
        nextCursor: null,
      }),
      getJob: vi.fn(),
      getResults: vi.fn(),
    });
    const store = arrange(provider);

    await store.adoptJobHistory();

    // The row is tracked for the panel (state + task label)...
    expect(store.jobs.get(keyFor('jr'))?.state).toBe('success');
    expect(store.submittedContexts.get(keyFor('jr'))?.taskId).toBe('t1');
    // ...with ZERO result traffic and no application.
    expect(provider.getJob).not.toHaveBeenCalled();
    expect(provider.getResults).not.toHaveBeenCalled();
    expect(autoLoadMock).not.toHaveBeenCalled();
  });

  it.each(['error', 'cancelled'] as const)(
    'records a terminal-%s handle from its `state` without a getJob',
    async (state) => {
      const provider = makeProvider({
        listJobHistory: vi
          .fn()
          .mockResolvedValue({ jobs: [handle({ state })], nextCursor: null }),
        getJob: vi.fn(),
        getResults: vi.fn(),
      });
      const store = arrange(provider);

      await store.adoptJobHistory();

      expect(provider.getJob).not.toHaveBeenCalled();
      expect(provider.getResults).not.toHaveBeenCalled();
      expect(autoLoadMock).not.toHaveBeenCalled();
      expect(store.jobs.get(keyFor('jr'))?.state).toBe(state);
      expect(store.submittedContexts.get(keyFor('jr'))?.taskId).toBe('t1');
    }
  );

  it('a terminal summary is adopted without status or result detail reads', async () => {
    const provider = makeProvider({
      listJobHistory: vi
        .fn()
        .mockResolvedValue({ jobs: [handle()], nextCursor: null }),
      getJob: vi.fn().mockResolvedValue(jobStatus('jr', 'success')),
      getResults: vi.fn(),
    });
    const store = arrange(provider);

    await store.adoptJobHistory();

    expect(provider.getJob).not.toHaveBeenCalled();
    expect(store.jobs.get(keyFor('jr'))?.state).toBe('success');
    expect(provider.getResults).not.toHaveBeenCalled();
    expect(autoLoadMock).not.toHaveBeenCalled();
  });

  it('a still-running re-discovered job is tracked for polling, not applied', async () => {
    const provider = makeProvider({
      listJobHistory: vi.fn().mockResolvedValue({
        jobs: [handle({ state: 'running', finishedAt: undefined })],
        nextCursor: null,
      }),
      getJob: vi.fn().mockResolvedValue(jobStatus('jr', 'running')),
      getResults: vi.fn().mockResolvedValue(resultsBundle(sampleResults)),
    });
    const store = arrange(provider);

    await store.adoptJobHistory();

    expect(store.jobs.get(keyFor('jr'))?.state).toBe('running');
    // The pinned lightweight summary intentionally carries no input URIs, so
    // history adoption does not reconstruct a backend-aware dataset binding.
    expect(
      store.submittedContexts.get(keyFor('jr'))?.activeDatasetId
    ).toBeUndefined();
    expect(provider.getResults).not.toHaveBeenCalled();
    expect(autoLoadMock).not.toHaveBeenCalled();
  });

  // The payoff: an ADOPTED still-running job that finishes while this page
  // is open converges through the ORDINARY poller → completion path (results
  // fetched + delivered to listeners), exactly like a job submitted this
  // session — the in-session live path stays.
  it('an adopted running job that finishes while open fires the ordinary live path', async () => {
    const getJob = vi
      .fn()
      .mockResolvedValueOnce(jobStatus('jr', 'running'))
      .mockResolvedValueOnce(jobStatus('jr', 'success'));
    const provider = makeProvider({
      listJobHistory: vi.fn().mockResolvedValue({
        jobs: [handle({ state: 'running', finishedAt: undefined })],
        nextCursor: null,
      }),
      getJob,
      getResults: vi.fn().mockResolvedValue(resultsBundle(sampleResults)),
    });
    const store = arrange(provider);
    const listener = vi.fn();
    store.onJobComplete(listener);

    await store.adoptJobHistory();
    expect(store.jobs.get(keyFor('jr'))?.state).toBe('running');

    // Let the adopted poller run its next cycle: the job is now terminal.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(provider.getResults).toHaveBeenCalledWith('jr');
    expect(listener).toHaveBeenCalledTimes(1);
    const completion = listener.mock.calls[0][0];
    expect(completion.status.state).toBe('success');
    expect(completion.results).toEqual(sampleResults);
  });

  // Reload durability: the adopted context has no in-session parent id, but
  // the persisted submitted parameters carry the image input's provenance
  // URIs verbatim — completion re-identifies the parent among the loaded
  // datasets so the labelmap result attaches instead of opening top-level.
  it('an adopted running job reconstructs its parent from persisted input provenance', async () => {
    const getJob = vi
      .fn()
      .mockResolvedValueOnce(jobStatus('jr', 'running'))
      .mockResolvedValueOnce(jobStatus('jr', 'success'));
    const provider = makeProvider({
      listJobHistory: vi.fn().mockResolvedValue({
        jobs: [handle({ state: 'running', finishedAt: undefined })],
        nextCursor: null,
      }),
      getJob,
      getJobHistoryDetail: vi.fn().mockResolvedValue({
        jobId: 'jr',
        log: [],
        parameters: {
          inputVolume: { type: 'image', uris: ['/f/a'] },
          iterations: 2,
        },
      }),
      getResults: vi.fn().mockResolvedValue(resultsBundle(sampleResults)),
    });
    const store = arrange(provider);
    const listener = vi.fn();
    store.onJobComplete(listener);

    await store.adoptJobHistory();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(listener).toHaveBeenCalledTimes(1);
    const completion = listener.mock.calls[0][0];
    expect(completion.context?.activeDatasetId).toBe('ds1');
    expect(store.submittedContexts.get(keyFor('jr'))?.activeDatasetId).toBe(
      'ds1'
    );
  });

  it('parent reconstruction never guesses on unmatched or ambiguous inputs', async () => {
    const getJob = vi
      .fn()
      .mockResolvedValueOnce(jobStatus('jr', 'running'))
      .mockResolvedValueOnce(jobStatus('jr', 'success'));
    const provider = makeProvider({
      listJobHistory: vi.fn().mockResolvedValue({
        jobs: [handle({ state: 'running', finishedAt: undefined })],
        nextCursor: null,
      }),
      getJob,
      getJobHistoryDetail: vi.fn().mockResolvedValue({
        jobId: 'jr',
        log: [],
        // URIs that match no loaded dataset → stays unbound (open-as-dataset).
        parameters: { inputVolume: { type: 'image', uris: ['/f/other'] } },
      }),
      getResults: vi.fn().mockResolvedValue(resultsBundle(sampleResults)),
    });
    const store = arrange(provider);
    const listener = vi.fn();
    store.onJobComplete(listener);

    await store.adoptJobHistory();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    const completion = listener.mock.calls[0][0];
    expect(completion.context?.activeDatasetId).toBeUndefined();
  });

  it('a job that settles between listing and the first poll completes once', async () => {
    const provider = makeProvider({
      listJobHistory: vi.fn().mockResolvedValue({
        jobs: [handle({ state: 'running', finishedAt: undefined })],
        nextCursor: null,
      }),
      getJob: vi.fn().mockResolvedValue(jobStatus('jr', 'success')),
      getResults: vi.fn().mockResolvedValue(resultsBundle(sampleResults)),
    });
    const store = arrange(provider);

    await store.adoptJobHistory();

    expect(store.jobs.get(keyFor('jr'))?.state).toBe('success');
    expect(provider.getResults).toHaveBeenCalledTimes(1);
  });

  it('a re-discovery listing failure is not fatal (logged, degrades)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const provider = makeProvider({
      listJobHistory: vi.fn().mockRejectedValue(new Error('boom')),
      getJob: vi.fn(),
    });
    const store = arrange(provider);

    await expect(store.adoptJobHistory()).resolves.toBeUndefined();
    expect(autoLoadMock).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalled();
  });

  it('does not re-adopt a job already tracked this session', async () => {
    const provider = makeProvider({
      listJobHistory: vi
        .fn()
        .mockResolvedValue({ jobs: [handle()], nextCursor: null }),
      getJob: vi.fn().mockResolvedValue(jobStatus('jr', 'success')),
      getResults: vi.fn().mockResolvedValue(resultsBundle(sampleResults)),
    });
    const store = arrange(provider);
    // A submit this session already owns this job id.
    store.recordSubmittedContext({
      jobId: 'jr',
      taskId: 't1',
      providerId: 'p1',
      submittedAt: '2026-07-03T19:00:00Z',
    });

    await store.adoptJobHistory();

    expect(provider.getJob).not.toHaveBeenCalled();
    expect(autoLoadMock).not.toHaveBeenCalled();
  });

  // Boot adoption can race an in-flight submit of the SAME job: the adoption
  // guard passes while `runTask` is still awaiting, so both paths start a
  // poll loop. Completion must still be delivered exactly once, and the
  // second loop's reschedule must REPLACE the first timer, never orphan it.
  const arrangeAdoptSubmitOverlap = (getJob: ReturnType<typeof vi.fn>) => {
    let resolveRun!: (ref: ProcessingJobRef) => void;
    const provider = makeProvider({
      listJobHistory: vi.fn().mockResolvedValue({
        jobs: [handle({ state: 'running', finishedAt: undefined })],
        nextCursor: null,
      }),
      runTask: vi.fn(
        () =>
          new Promise<ProcessingJobRef>((resolve) => {
            resolveRun = resolve;
          })
      ),
      getJob: getJob as ProcessingProvider['getJob'],
      getResults: vi.fn().mockResolvedValue(resultsBundle(sampleResults)),
    });
    const store = arrange(provider);
    return { store, provider, resolveRun: () => resolveRun({ jobId: 'jr' }) };
  };

  it('adopt + in-flight submit of the same job delivers completion exactly once', async () => {
    // The third-and-later polls resolve by hand, so BOTH loops' pollOnce can
    // be suspended mid-await together — the interleaving where each observes
    // the terminal state and tries to deliver.
    const gates: Array<(status: ProcessingJobStatus) => void> = [];
    const getJob = vi
      .fn()
      // adoption's status probe, then the submit loop's first poll…
      .mockResolvedValueOnce(jobStatus('jr', 'running'))
      .mockResolvedValueOnce(jobStatus('jr', 'running'))
      // …then gated for every loop still alive.
      .mockImplementation(
        () =>
          new Promise<ProcessingJobStatus>((resolve) => {
            gates.push(resolve);
          })
      );
    const { store, provider, resolveRun } = arrangeAdoptSubmitOverlap(getJob);
    const listener = vi.fn();
    store.onJobComplete(listener);

    const submitted = store.submitJob('p1', 't1', {}, {});
    await store.adoptJobHistory();
    resolveRun();
    await submitted;

    // Fire every pending poll timer, then release all suspended polls with
    // the terminal state at once.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    gates.forEach((resolve) => resolve(jobStatus('jr', 'success')));
    await vi.advanceTimersByTimeAsync(0);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(provider.getResults).toHaveBeenCalledTimes(1);
    const successes = useMessageStore().messages.filter(
      (m) => m.type === MessageType.Success
    );
    expect(successes).toHaveLength(1);
  });

  it('a duplicate poll loop is collapsed, so stopPolling stops ALL polling', async () => {
    // Never terminal: pins the timer bookkeeping alone.
    const getJob = vi.fn().mockResolvedValue(jobStatus('jr', 'running'));
    const { store, resolveRun } = arrangeAdoptSubmitOverlap(getJob);

    const submitted = store.submitJob('p1', 't1', {}, {});
    await store.adoptJobHistory();
    resolveRun();
    await submitted;

    store.stopPolling(keyFor('jr'));
    const callsAtStop = getJob.mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);

    // An orphaned first-loop timer would fire here and keep polling.
    expect(getJob.mock.calls.length).toBe(callsAtStop);
  });
});

// ---------------------------------------------------------------------------
// P-02 — immutable provider registration + provider-qualified job keys.
//
// A provider id encodes its launch folder, so registration is IMMUTABLE, and
// every per-job collection is keyed by (providerId, jobId): two folder-scoped
// providers may each mint the same raw jobId ("1"), and only the composite key
// keeps them from colliding.
// ---------------------------------------------------------------------------

describe('Providers store — P-02: immutable registration + provider-qualified job keys', () => {
  const cfg = (
    overrides: Partial<ProcessingProviderConfig> = {}
  ): ProcessingProviderConfig => ({
    id: 'p1',
    label: 'Fake',
    baseUrl: 'http://localhost/',
    jobsBaseUrl: 'http://localhost/jobs',
    ...overrides,
  });

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    datasetState.ids = [];
    datasetState.sources = {};
    createProviderMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- Immutability of registerProviderConfig ------------------------------

  it('stores the config on first registration', () => {
    const store = useProcessingJobsStore();
    store.registerProviderConfig(cfg());
    expect(store.providerCount).toBe(1);
    expect(store.configs.get('p1')?.jobsBaseUrl).toBe('http://localhost/jobs');
  });

  it('re-registering a structurally-identical config is a no-op (no throw)', () => {
    const store = useProcessingJobsStore();
    store.registerProviderConfig(cfg());
    // A fresh-but-equal object (as a re-boot would build) must not throw.
    expect(() => store.registerProviderConfig(cfg())).not.toThrow();
    expect(store.providerCount).toBe(1);
  });

  it('throws when the same id is registered with a different config', () => {
    const store = useProcessingJobsStore();
    store.registerProviderConfig(cfg());

    // Any structural difference under the same id is a configuration error.
    expect(() =>
      store.registerProviderConfig(cfg({ baseUrl: 'http://localhost/other/' }))
    ).toThrow();
    expect(() =>
      store.registerProviderConfig(
        cfg({ jobsBaseUrl: 'http://localhost/other-jobs' })
      )
    ).toThrow();

    // A rejected re-registration never mutates the stored config or the count.
    expect(store.providerCount).toBe(1);
    expect(store.configs.get('p1')?.baseUrl).toBe('http://localhost/');
  });

  it('registers two distinct ids/folders that both resolve via getProvider', async () => {
    const store = useProcessingJobsStore();
    store.registerProviderConfig(cfg({ id: 'A' }));
    store.registerProviderConfig(cfg({ id: 'B' }));
    // providerCount counts DISTINCT ids only.
    expect(store.providerCount).toBe(2);

    const a = makeProvider({ config: cfg({ id: 'A' }) });
    const b = makeProvider({ config: cfg({ id: 'B' }) });
    store.instances.set('A', a);
    store.instances.set('B', b);

    // Each id resolves to its OWN provider (the Pinia store wraps the stored
    // instance in a reactive proxy, so compare identity by config, not ref).
    const resolvedA = await store.getProvider('A');
    const resolvedB = await store.getProvider('B');
    expect(resolvedA.config.id).toBe('A');
    expect(resolvedB.config.id).toBe('B');
    expect(resolvedA).not.toBe(resolvedB);
  });

  // --- Two-provider isolation (both mint raw jobId "1") --------------------

  it('isolates two providers that both mint raw jobId "1"', async () => {
    const store = useProcessingJobsStore();
    store.registerProviderConfig(cfg({ id: 'A' }));
    store.registerProviderConfig(cfg({ id: 'B' }));

    const aResults: ProcessingResult[] = [
      { id: 'ra', name: 'a.nrrd', url: 'http://localhost/a.nrrd' },
    ];
    const bResults: ProcessingResult[] = [
      { id: 'rb', name: 'b.nrrd', url: 'http://localhost/b.nrrd' },
    ];

    const providerA = makeProvider({
      config: cfg({ id: 'A' }),
      runTask: vi.fn().mockResolvedValue({ jobId: '1' } as ProcessingJobRef),
      getJob: vi.fn().mockResolvedValue(jobStatus('1', 'success')),
      getResults: vi.fn().mockResolvedValue(resultsBundle(aResults)),
      cancelJob: vi.fn().mockResolvedValue(jobStatus('1', 'cancelled')),
      deleteJob: vi.fn().mockResolvedValue(undefined),
    });
    const providerB = makeProvider({
      config: cfg({ id: 'B' }),
      runTask: vi.fn().mockResolvedValue({ jobId: '1' } as ProcessingJobRef),
      getJob: vi.fn().mockResolvedValue(jobStatus('1', 'success')),
      getResults: vi.fn().mockResolvedValue(resultsBundle(bResults)),
      cancelJob: vi.fn().mockResolvedValue(jobStatus('1', 'cancelled')),
      deleteJob: vi.fn().mockResolvedValue(undefined),
    });
    store.instances.set('A', providerA);
    store.instances.set('B', providerB);

    await store.submitJob('A', 'task-A', {}, {});
    await store.submitJob('B', 'task-B', {}, {});
    // Flush both immediate poll loops to their independent completions.
    await vi.advanceTimersByTimeAsync(0);

    const keyA = keyFor('1', 'A');
    const keyB = keyFor('1', 'B');

    // Two DISTINCT rows keyed by (providerId, jobId) — never collapsed onto "1".
    expect(keyA).not.toBe(keyB);
    expect(store.jobs.size).toBe(2);
    expect(store.jobs.get(keyA)?.state).toBe('success');
    expect(store.jobs.get(keyB)?.state).toBe('success');

    // Each provider polled + fetched its OWN results (independent lifecycles).
    expect(providerA.getJob).toHaveBeenCalledWith('1');
    expect(providerB.getJob).toHaveBeenCalledWith('1');
    expect(providerA.getResults).toHaveBeenCalledWith('1');
    expect(providerB.getResults).toHaveBeenCalledWith('1');

    // Distinct contexts + distinct results — no cross-contamination.
    expect(store.submittedContexts.get(keyA)?.taskId).toBe('task-A');
    expect(store.submittedContexts.get(keyB)?.taskId).toBe('task-B');
    expect(store.jobResults.get(keyA)).toEqual(aResults);
    expect(store.jobResults.get(keyB)).toEqual(bResults);

    // cancelJob(A) reaches ONLY provider A.
    await store.cancelJob(ref('1', 'A'));
    expect(providerA.cancelJob).toHaveBeenCalledWith('1');
    expect(providerB.cancelJob).not.toHaveBeenCalled();

    // deleteJob(A) tears down ONLY provider A's row; B is fully intact.
    await store.deleteJob(ref('1', 'A'));
    expect(providerA.deleteJob).toHaveBeenCalledWith('1');
    expect(providerB.deleteJob).not.toHaveBeenCalled();
    expect(store.jobs.has(keyA)).toBe(false);
    expect(store.jobResults.has(keyA)).toBe(false);
    expect(store.submittedContexts.has(keyA)).toBe(false);
    // Provider B's job, status, and results are untouched.
    expect(store.jobs.get(keyB)?.state).toBe('success');
    expect(store.jobResults.get(keyB)).toEqual(bResults);
    expect(store.submittedContexts.get(keyB)?.taskId).toBe('task-B');
  });

  // --- getProvider retry (a rejected load is evicted from `loading`) -------

  it('retries a provider load after a rejected attempt (evicts the dead promise)', async () => {
    const store = useProcessingJobsStore();
    store.registerProviderConfig(cfg({ id: 'retry' }));

    const provider = makeProvider({ config: cfg({ id: 'retry' }) });
    // The lazily-imported factory rejects once, then succeeds.
    createProviderMock
      .mockImplementationOnce(() => {
        throw new Error('load failed');
      })
      .mockImplementationOnce(() => provider);

    // First load rejects — and must NOT be cached as a permanently-dead promise.
    await expect(store.getProvider('retry')).rejects.toThrow('load failed');
    // Second load re-invokes the factory (the failed promise was evicted).
    await expect(store.getProvider('retry')).resolves.toBe(provider);
    expect(createProviderMock).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Commit-if-current: every continuation after an `await` verifies the job's
// lifecycle generation before mutating state. A job deleted while a request is
// in flight must never be resurrected by the late response.
// ---------------------------------------------------------------------------

describe('Providers store — generation-guarded continuations', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    datasetState.ids = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (err: unknown) => void;
  };
  const deferred = <T>(): Deferred<T> => {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  it('deleting a job while its terminal getResults is in flight drops the results (no resurrection)', async () => {
    const store = useProcessingJobsStore();
    const results = deferred<ReturnType<typeof resultsBundle>>();
    const status = jobStatus('job-del', 'success');
    const provider = makeProvider({
      runTask: vi
        .fn()
        .mockResolvedValue({ jobId: 'job-del', status } as ProcessingJobRef),
      getResults: vi.fn().mockReturnValue(results.promise),
    });
    store.instances.set('p1', provider);
    const listener = vi.fn();
    store.onJobComplete(listener);

    // Born-terminal submit: fireCompletion starts and blocks on getResults.
    const submitP = store.submitJob('p1', 'task-1', {}, {});
    await vi.advanceTimersByTimeAsync(0);
    expect(provider.getResults).toHaveBeenCalledTimes(1);

    // Delete lands mid-fetch, then the deferred results resolve.
    await store.deleteJob(ref('job-del'));
    results.resolve(resultsBundle(sampleResults));
    await submitP;

    // The deleted job is NOT repopulated and its completion never fires.
    expect(store.jobs.has(keyFor('job-del'))).toBe(false);
    expect(store.jobResults.has(keyFor('job-del'))).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(
      useMessageStore().messages.filter((m) => m.type === MessageType.Success)
    ).toHaveLength(0);
  });

  it('a getResults rejection after the delete does not recreate the job as an error row', async () => {
    const store = useProcessingJobsStore();
    const results = deferred<ReturnType<typeof resultsBundle>>();
    const status = jobStatus('job-del-err', 'success');
    const provider = makeProvider({
      runTask: vi.fn().mockResolvedValue({
        jobId: 'job-del-err',
        status,
      } as ProcessingJobRef),
      getResults: vi.fn().mockReturnValue(results.promise),
    });
    store.instances.set('p1', provider);
    const listener = vi.fn();
    store.onJobComplete(listener);

    const submitP = store.submitJob('p1', 'task-1', {}, {});
    await vi.advanceTimersByTimeAsync(0);
    await store.deleteJob(ref('job-del-err'));
    results.reject(new Error('fetch blew up'));
    await submitP;

    expect(store.jobs.has(keyFor('job-del-err'))).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(
      useMessageStore().messages.filter((m) => m.type === MessageType.Error)
    ).toHaveLength(0);
  });

  it('an on-demand loadJobResults resolving after the delete commits nothing', async () => {
    const store = useProcessingJobsStore();
    const results = deferred<ReturnType<typeof resultsBundle>>();
    const provider = makeProvider({
      getResults: vi.fn().mockReturnValue(results.promise),
    });
    store.instances.set('p1', provider);

    // An adopted terminal job: tracked context + terminal row, no live results.
    store.recordSubmittedContext({
      jobId: 'job-hist',
      taskId: 'task-1',
      providerId: 'p1',
      submittedAt: new Date().toISOString(),
    });
    store.recordJob('p1', jobStatus('job-hist', 'success'));

    const loadP = store.loadJobResults(ref('job-hist'));
    await vi.advanceTimersByTimeAsync(0);
    expect(provider.getResults).toHaveBeenCalledTimes(1);

    await store.deleteJob(ref('job-hist'));
    results.resolve(resultsBundle(sampleResults));
    await loadP;

    expect(store.jobResults.has(keyFor('job-hist'))).toBe(false);
    expect(store.jobs.has(keyFor('job-hist'))).toBe(false);
  });
});
