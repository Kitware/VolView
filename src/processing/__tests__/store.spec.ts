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
import { makeFakeProvider } from './fakeProvider';

const { datasetState } = vi.hoisted(() => ({
  datasetState: {
    ids: [] as string[],
    sources: {} as Record<string, unknown>,
  },
}));
vi.mock('@/src/store/datasets', () => ({
  useDatasetStore: () => ({
    idsAsSelections: datasetState.ids,
    getDataSource: (id: string) => datasetState.sources[id],
  }),
}));

const { autoLoadMock } = vi.hoisted(() => ({ autoLoadMock: vi.fn() }));
vi.mock('@/src/processing/applyResults', () => ({
  autoLoadProcessingResults: autoLoadMock,
}));

const { createProviderMock } = vi.hoisted(() => ({
  createProviderMock: vi.fn(),
}));
vi.mock('@/src/processing/engine/transport', () => ({
  createEngineTransport: createProviderMock,
}));

const makeProvider = (
  overrides: Partial<ProcessingProvider>
): ProcessingProvider =>
  makeFakeProvider(
    {
      id: 'p1',
      label: 'Fake',
      baseUrl: 'http://localhost/',
      jobsBaseUrl: 'http://localhost/jobs',
    },
    {
      getTaskSpec: vi.fn().mockResolvedValue({
        specVersion: 1,
        id: 't',
        title: 'T',
        parameters: [],
        outputs: [],
      }),
      getResults: vi.fn().mockResolvedValue(resultsBundle()),
      cancelJob: vi.fn().mockResolvedValue({
        jobId: 'x',
        state: 'cancelled',
        resultState: 'unavailable',
      }),
      ...overrides,
    }
  );

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

const resultsBundle = (results: ProcessingResult[] = [], missing = 0) => ({
  results,
  missing,
});

const httpError = (status: number, code?: string): Error => {
  const err = new Error(`Request failed: ${status}`) as Error & {
    status: number;
    code?: string;
  };
  err.status = status;
  err.code = code;
  return err;
};

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

    await vi.advanceTimersByTimeAsync(0);
    expect(getJob).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();

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

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(getJob).toHaveBeenCalledTimes(2);
  });

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

    await store.cancelJob(ref(jobId));
    expect(cancelJob).toHaveBeenCalledTimes(1);
    expect(cancelJob).toHaveBeenCalledWith('job-cancel');
    expect(listener).not.toHaveBeenCalled();
    expect(store.jobs.get(keyFor('job-cancel'))?.state).toBe('running');

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
    expect(getResults).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(getJob).toHaveBeenCalledTimes(2);
  });

  it('cancel of an untracked job is a no-op', async () => {
    const store = useProcessingJobsStore();
    const cancelJob = vi.fn();
    store.instances.set('p1', makeProvider({ cancelJob }));

    await expect(store.cancelJob(ref('ghost'))).resolves.toBe(false);
    expect(cancelJob).not.toHaveBeenCalled();
  });

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

    await expect(store.cancelJob(ref(jobId))).resolves.toBe(false);

    const errs = useMessageStore().messages.filter(
      (m) => m.type === MessageType.Error
    );
    expect(errs.some((m) => /cancel/i.test(m.title))).toBe(true);
    expect(store.jobs.get(keyFor('job-cf'))?.state).toBe('running');
  });

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

    await vi.advanceTimersByTimeAsync(0);
    expect(listener).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
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

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(getJob).toHaveBeenCalledTimes(2);
  });

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

  it('replays a terminal completion to a listener that subscribes after the event', async () => {
    const store = useProcessingJobsStore();

    const status = jobStatus('job-replay', 'success');
    const getJob = vi.fn();
    const getResults = vi.fn().mockResolvedValue(resultsBundle(sampleResults));
    const runTask = vi
      .fn()
      .mockResolvedValue({ jobId: 'job-replay', status } as ProcessingJobRef);
    const provider = makeProvider({ runTask, getJob, getResults });
    store.instances.set('p1', provider);

    await store.submitJob('p1', 'task-1', {}, {});
    expect(store.jobs.get(keyFor('job-replay'))?.state).toBe('success');
    expect(store.jobResults.get(keyFor('job-replay'))).toEqual(sampleResults);

    const listener = vi.fn();
    const unsubscribe = store.onJobComplete(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ status, results: sampleResults })
    );

    unsubscribe();
    const listener2 = vi.fn();
    store.onJobComplete(listener2);
    expect(listener2).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('bounds transient poll retries with backoff, then fails the job loud', async () => {
    const store = useProcessingJobsStore();

    // No HTTP status makes the error transient.
    const getJob = vi.fn().mockRejectedValue(new Error('network blip'));
    const runTask = vi
      .fn()
      .mockResolvedValue({ jobId: 'job-flaky' } as ProcessingJobRef);
    const provider = makeProvider({ runTask, getJob });
    store.instances.set('p1', provider);

    const listener = vi.fn();
    store.onJobComplete(listener);

    await store.submitJob('p1', 'task-1', {}, {});

    // Backoff pushes the next retry past the base interval.
    await vi.advanceTimersByTimeAsync(0);
    expect(getJob).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(getJob).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    expect(getJob).toHaveBeenCalledTimes(MAX_POLL_RETRIES + 1);
    expect(store.jobs.get(keyFor('job-flaky'))?.state).toBe('error');
    expect(errorMessages().length).toBeGreaterThan(0);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        status: expect.objectContaining({ state: 'error' }),
        results: [],
      })
    );

    const settled = getJob.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(getJob).toHaveBeenCalledTimes(settled);
  });

  it('fails a job immediately on a permanent poll error, without retrying', async () => {
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
    expect(getJob).toHaveBeenCalledTimes(1);
  });

  it('surfaces a submit failure in the message center instead of swallowing it', async () => {
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

  it('treats a results-fetch error as an error, never empty results', async () => {
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

    expect(getResults).toHaveBeenCalledTimes(1);
    expect(store.jobs.get(keyFor('job-fetch-fail'))?.state).toBe('error');
    expect(store.jobResults.get(keyFor('job-fetch-fail'))).toBeUndefined();
    expect(errorMessages().some((m) => /result/i.test(m.title))).toBe(true);

    expect(listener).toHaveBeenCalledTimes(1);
    const completion = listener.mock.calls[0][0];
    expect(completion.status.state).toBe('error');
    expect(completion.results).toEqual([]);
  });

  it('stops timers and drops job records on clear', async () => {
    const store = useProcessingJobsStore();

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

    store.clearProviders();
    expect(store.jobs.size).toBe(0);
    expect(store.jobResults.size).toBe(0);
    expect(store.submittedContexts.size).toBe(0);

    await vi.advanceTimersByTimeAsync(10 * POLL_INTERVAL_MS);
    expect(getJob).toHaveBeenCalledTimes(polledBeforeClear);
  });

  // Stale completion markers would suppress a recycled jobId from firing again.
  it('deleteJob clears completion bookkeeping so a recycled jobId completes again', async () => {
    const store = useProcessingJobsStore();
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

    const jobId = await store.submitJob('p1', 'task-1', {}, {});
    expect(jobId).toBe('job-recycle');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getResults).toHaveBeenCalledTimes(1);

    await store.deleteJob(ref('job-recycle'));
    expect(deleteJob).toHaveBeenCalledWith('job-recycle');
    expect(store.jobs.has(keyFor('job-recycle'))).toBe(false);
    expect(store.submittedContexts.has(keyFor('job-recycle'))).toBe(false);

    await store.submitJob('p1', 'task-1', {}, {});
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getResults).toHaveBeenCalledTimes(2);
    expect(store.jobs.get(keyFor('job-recycle'))?.state).toBe('success');
  });

  it('marks the session expired and stops all polling on a 401 mid-job', async () => {
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

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(getJob).toHaveBeenCalledTimes(1);
  });

  // Girder returns 403 for a per-resource denial while the session is still
  // valid (another user's job, an ACL edited mid-session) and 401 only when the
  // token itself is gone/expired. A single 403 must not be read as "the whole
  // session died".
  it('a 403 on one job fails that job only — other jobs keep polling', async () => {
    const store = useProcessingJobsStore();

    const getJob = vi.fn().mockImplementation(async (jobId: string) => {
      if (jobId === 'job-403') throw httpError(403);
      return jobStatus('job-ok', 'running');
    });
    const runTask = vi
      .fn()
      .mockResolvedValueOnce({ jobId: 'job-403' } as ProcessingJobRef)
      .mockResolvedValueOnce({ jobId: 'job-ok' } as ProcessingJobRef);
    const provider = makeProvider({ runTask, getJob });
    store.instances.set('p1', provider);

    await store.submitJob('p1', 'task-1', {}, {});
    await store.submitJob('p1', 'task-1', {}, {});
    await vi.advanceTimersByTimeAsync(0);

    // The denied job fails with an error status...
    expect(store.jobs.get(keyFor('job-403'))?.state).toBe('error');
    // ...but the session is NOT declared expired and no persistent expiry
    // error is posted.
    expect(store.sessionExpired).toBe(false);
    expect(
      errorMessages().some((m) => /session has expired/i.test(m.title))
    ).toBe(false);

    // The other job's polling survives.
    const pollsBefore = getJob.mock.calls.filter(
      ([id]) => id === 'job-ok'
    ).length;
    await vi.advanceTimersByTimeAsync(3 * POLL_INTERVAL_MS);
    expect(
      getJob.mock.calls.filter(([id]) => id === 'job-ok').length
    ).toBeGreaterThan(pollsBefore);
  });

  it('detects a base image deleted mid-job and messages without dropping the result', async () => {
    datasetState.ids = [];
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

    await store.submitJob(
      'p1',
      'task-1',
      {},
      { activeDatasetId: 'ds-removed' }
    );

    expect(warningMessages().some((m) => /base image/i.test(m.title))).toBe(
      true
    );
    expect(store.jobResults.get(keyFor('job-orphan'))).toEqual(sampleResults);
    const completion = listener.mock.calls[0][0];
    expect(completion.baseImageMissing).toBe(true);
    expect(completion.results).toEqual(sampleResults);
  });

  it('does not flag a missing base image when the originating dataset is still loaded', async () => {
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

    const warning = warningMessages().find((m) =>
      /could not be retrieved/i.test(m.title)
    );
    expect(warning).toBeTruthy();
    expect(warning?.title).toContain('2');
    expect(store.jobResults.get(keyFor('job-miss'))).toEqual(sampleResults);
    expect(listener.mock.calls[0][0].results).toEqual(sampleResults);
  });

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

  it('a provider registered AFTER adoption still loads its job history', async () => {
    const store = useProcessingJobsStore();

    await store.adoptJobHistory();
    expect(store.jobHistoryComplete).toBe(true);

    const listJobHistory = vi
      .fn()
      .mockResolvedValue({ jobs: [handle()], nextCursor: null });
    const provider = makeProvider({ listJobHistory });
    store.instances.set('p1', provider);
    store.registerProviderConfig(config);

    await vi.runAllTimersAsync();

    expect(listJobHistory).toHaveBeenCalled();
    expect(store.jobHistory.size).toBe(1);
    expect(store.jobHistoryComplete).toBe(true);
  });

  it('an empty job history adopts nothing (no re-discovery, no apply)', async () => {
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

    await Promise.all([store.loadMoreJobHistory(), store.loadMoreJobHistory()]);
    expect(listJobHistory).toHaveBeenCalledTimes(3);
    expect(listJobHistory).toHaveBeenNthCalledWith(3, 'page-2');
    expect(store.jobHistoryComplete).toBe(true);
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

    expect(store.jobs.get(keyFor('jr'))?.state).toBe('success');
    expect(store.submittedContexts.get(keyFor('jr'))?.taskId).toBe('t1');
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
    // The pinned summary carries no input URIs, so no dataset binding is
    // reconstructed.
    expect(
      store.submittedContexts.get(keyFor('jr'))?.activeDatasetId
    ).toBeUndefined();
    expect(provider.getResults).not.toHaveBeenCalled();
    expect(autoLoadMock).not.toHaveBeenCalled();
  });

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

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(provider.getResults).toHaveBeenCalledWith('jr');
    expect(listener).toHaveBeenCalledTimes(1);
    const completion = listener.mock.calls[0][0];
    expect(completion.status.state).toBe('success');
    expect(completion.results).toEqual(sampleResults);
  });

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

  it('loadJobResults on an adopted terminal job reconstructs its parent', async () => {
    const provider = makeProvider({
      listJobHistory: vi.fn().mockResolvedValue({
        jobs: [handle({ state: 'success' })],
        nextCursor: null,
      }),
      getJobHistoryDetail: vi.fn().mockResolvedValue({
        jobId: 'jr',
        log: [],
        parameters: { inputVolume: { type: 'image', uris: ['/f/a'] } },
      }),
      getResults: vi.fn().mockResolvedValue(resultsBundle(sampleResults)),
    });
    const store = arrange(provider);

    await store.adoptJobHistory();
    expect(
      store.submittedContexts.get(keyFor('jr'))?.activeDatasetId
    ).toBeUndefined();

    await store.loadJobResults(ref('jr'));

    expect(store.jobResults.get(keyFor('jr'))).toEqual(sampleResults);
    expect(store.submittedContexts.get(keyFor('jr'))?.activeDatasetId).toBe(
      'ds1'
    );
    expect(autoLoadMock).not.toHaveBeenCalled();
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

  // Boot adoption can race an in-flight submit of the same job, so both paths start a poll loop.
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
    // Gating the third and later polls suspends both loops mid-await together.
    const gates: Array<(status: ProcessingJobStatus) => void> = [];
    const getJob = vi
      .fn()
      .mockResolvedValueOnce(jobStatus('jr', 'running'))
      .mockResolvedValueOnce(jobStatus('jr', 'running'))
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

  it('stores the config on first registration', () => {
    const store = useProcessingJobsStore();
    store.registerProviderConfig(cfg());
    expect(store.configs.size).toBe(1);
    expect(store.configs.get('p1')?.jobsBaseUrl).toBe('http://localhost/jobs');
  });

  it('re-registering a structurally-identical config is a no-op (no throw)', () => {
    const store = useProcessingJobsStore();
    store.registerProviderConfig(cfg());
    expect(() => store.registerProviderConfig(cfg())).not.toThrow();
    expect(store.configs.size).toBe(1);
  });

  it('throws when the same id is registered with a different config', () => {
    const store = useProcessingJobsStore();
    store.registerProviderConfig(cfg());

    expect(() =>
      store.registerProviderConfig(cfg({ baseUrl: 'http://localhost/other/' }))
    ).toThrow();
    expect(() =>
      store.registerProviderConfig(
        cfg({ jobsBaseUrl: 'http://localhost/other-jobs' })
      )
    ).toThrow();

    expect(store.configs.size).toBe(1);
    expect(store.configs.get('p1')?.baseUrl).toBe('http://localhost/');
  });

  it('registers two distinct ids/folders that both resolve via getProvider', async () => {
    const store = useProcessingJobsStore();
    store.registerProviderConfig(cfg({ id: 'A' }));
    store.registerProviderConfig(cfg({ id: 'B' }));
    expect(store.configs.size).toBe(2);

    const a = makeProvider({ config: cfg({ id: 'A' }) });
    const b = makeProvider({ config: cfg({ id: 'B' }) });
    store.instances.set('A', a);
    store.instances.set('B', b);

    // Pinia wraps stored instances in a reactive proxy, so compare by config.
    const resolvedA = await store.getProvider('A');
    const resolvedB = await store.getProvider('B');
    expect(resolvedA.config.id).toBe('A');
    expect(resolvedB.config.id).toBe('B');
    expect(resolvedA).not.toBe(resolvedB);
  });

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
    await vi.advanceTimersByTimeAsync(0);

    const keyA = keyFor('1', 'A');
    const keyB = keyFor('1', 'B');

    expect(keyA).not.toBe(keyB);
    expect(store.jobs.size).toBe(2);
    expect(store.jobs.get(keyA)?.state).toBe('success');
    expect(store.jobs.get(keyB)?.state).toBe('success');

    expect(providerA.getJob).toHaveBeenCalledWith('1');
    expect(providerB.getJob).toHaveBeenCalledWith('1');
    expect(providerA.getResults).toHaveBeenCalledWith('1');
    expect(providerB.getResults).toHaveBeenCalledWith('1');

    expect(store.submittedContexts.get(keyA)?.taskId).toBe('task-A');
    expect(store.submittedContexts.get(keyB)?.taskId).toBe('task-B');
    expect(store.jobResults.get(keyA)).toEqual(aResults);
    expect(store.jobResults.get(keyB)).toEqual(bResults);

    await store.cancelJob(ref('1', 'A'));
    expect(providerA.cancelJob).toHaveBeenCalledWith('1');
    expect(providerB.cancelJob).not.toHaveBeenCalled();

    await store.deleteJob(ref('1', 'A'));
    expect(providerA.deleteJob).toHaveBeenCalledWith('1');
    expect(providerB.deleteJob).not.toHaveBeenCalled();
    expect(store.jobs.has(keyA)).toBe(false);
    expect(store.jobResults.has(keyA)).toBe(false);
    expect(store.submittedContexts.has(keyA)).toBe(false);
    expect(store.jobs.get(keyB)?.state).toBe('success');
    expect(store.jobResults.get(keyB)).toEqual(bResults);
    expect(store.submittedContexts.get(keyB)?.taskId).toBe('task-B');
  });

  it('retries a provider load after a rejected attempt (evicts the dead promise)', async () => {
    const store = useProcessingJobsStore();
    store.registerProviderConfig(cfg({ id: 'retry' }));

    const provider = makeProvider({ config: cfg({ id: 'retry' }) });
    createProviderMock
      .mockImplementationOnce(() => {
        throw new Error('load failed');
      })
      .mockImplementationOnce(() => provider);

    await expect(store.getProvider('retry')).rejects.toThrow('load failed');
    await expect(store.getProvider('retry')).resolves.toEqual(provider);
    expect(createProviderMock).toHaveBeenCalledTimes(2);
  });
});

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

    const submitP = store.submitJob('p1', 'task-1', {}, {});
    await vi.advanceTimersByTimeAsync(0);
    expect(provider.getResults).toHaveBeenCalledTimes(1);

    await store.deleteJob(ref('job-del'));
    results.resolve(resultsBundle(sampleResults));
    await submitP;

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

  it('deleting a job during the adopted-parent await drops a non-success completion', async () => {
    const store = useProcessingJobsStore();
    const detail =
      deferred<
        Awaited<ReturnType<ProcessingProvider['getJobHistoryDetail']>>
      >();
    const status = jobStatus('job-del-fail', 'error');
    const provider = makeProvider({
      runTask: vi.fn().mockResolvedValue({
        jobId: 'job-del-fail',
        status,
      } as ProcessingJobRef),
      getJobHistoryDetail: vi.fn().mockReturnValue(detail.promise),
    });
    store.instances.set('p1', provider);
    const listener = vi.fn();
    store.onJobComplete(listener);

    const submitP = store.submitJob('p1', 'task-1', {}, {});
    await vi.advanceTimersByTimeAsync(0);
    expect(provider.getJobHistoryDetail).toHaveBeenCalledTimes(1);

    await store.deleteJob(ref('job-del-fail'));
    detail.resolve({ parameters: {} } as Awaited<
      ReturnType<ProcessingProvider['getJobHistoryDetail']>
    >);
    await submitP;

    expect(store.jobs.has(keyFor('job-del-fail'))).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('an on-demand loadJobResults resolving after the delete commits nothing', async () => {
    const store = useProcessingJobsStore();
    const results = deferred<ReturnType<typeof resultsBundle>>();
    const provider = makeProvider({
      getResults: vi.fn().mockReturnValue(results.promise),
    });
    store.instances.set('p1', provider);

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
