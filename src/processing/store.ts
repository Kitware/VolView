// Job records and poll machinery outlive the Jobs component's unmounts.

import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import deepEqual from 'fast-deep-equal';

import type { JobHistoryDetail, JobHistorySummary } from '@/backend-contract';
import { inputValueSchema, TYPE_TAG_LABELMAP } from '@/backend-contract';
import { collectProvenanceUris } from '@/src/processing/engine/mintInput';
import type {
  ProcessingJobStatus,
  ProcessingProvider,
  ProcessingProviderConfig,
  ProcessingResult,
  ProcessingValue,
  SubmittedJobContext,
  TrackedJobRef,
} from '@/src/processing/types';
import {
  jobKey,
  isTerminalJobState,
  missingJobErrorDetails,
} from '@/src/processing/types';
import type { TrackedJobHistorySummary } from '@/src/processing/engine/jobHistory';
import { selectJobHistoryRows } from '@/src/processing/engine/jobHistory';
import { useMessageStore } from '@/src/store/messages';
import { useDatasetStore } from '@/src/store/datasets';

export const POLL_INTERVAL_MS = 2000;
export const MAX_POLL_RETRIES = 4;
export const MAX_POLL_BACKOFF_MS = 30000;

const completionReady = (status: ProcessingJobStatus): boolean =>
  isTerminalJobState(status.state);

type PollErrorKind =
  | 'transient'
  | 'permanent'
  | 'session-expired'
  | 'resource-gone';

const classifyError = (err: unknown): PollErrorKind => {
  const status = (err as { status?: number } | null | undefined)?.status;
  if (status === 401 || status === 403) return 'session-expired';
  if (status === 404 || status === 410) return 'resource-gone';
  if (typeof status === 'number' && status >= 400 && status < 500)
    return 'permanent';
  // No HTTP status means the fetch itself rejected: offline, DNS, or CORS.
  return 'transient';
};

const errorMessage = (err: unknown, fallback?: string): string =>
  err instanceof Error ? err.message : (fallback ?? String(err));

// Unresolved outputs are a partial loss: warn without dropping the results that
// did resolve.
const warnMissingOutputs = (n: number): void => {
  const plural = n === 1 ? '' : 's';
  useMessageStore().addWarning(`${n} output${plural} could not be retrieved`, {
    details: `${n} of this job's recorded output${plural} could not be retrieved (deleted or unreadable). The results that resolved are available in the Jobs panel.`,
  });
};

// `baseImageMissing` means the results must be surfaced but not auto-attached to
// a parent that no longer exists.
export type JobCompletion = {
  status: ProcessingJobStatus;
  results: ProcessingResult[];
  context?: SubmittedJobContext;
  baseImageMissing?: boolean;
};

type CompletionListener = (completion: JobCompletion) => void;

const loadProvider = async (
  config: ProcessingProviderConfig
): Promise<ProcessingProvider> => {
  // Dynamic import keeps the engine chunk out of the boot bundle.
  const { createProvider } =
    await import('@/src/processing/engine/createProvider');
  return createProvider(config);
};

export const useProcessingJobsStore = defineStore('processingJobs', () => {
  const configs = reactive(new Map<string, ProcessingProviderConfig>());

  const instances = reactive(new Map<string, ProcessingProvider>());
  const loading = reactive(new Map<string, Promise<ProcessingProvider>>());

  // Every per-job collection is keyed by jobKey, never a raw jobId: two
  // context-scoped providers may mint the same raw jobId.
  const jobs = reactive(new Map<string, ProcessingJobStatus>());
  const jobHistory = reactive(new Map<string, TrackedJobHistorySummary>());
  const jobHistoryDetails = reactive(new Map<string, JobHistoryDetail>());
  const jobHistoryCursors = new Map<string, string | null>();
  const jobHistoryLoading = ref(false);
  const jobHistoryComplete = ref(false);
  const jobHistoryErrors = reactive(new Map<string, string>());
  const jobHistoryError = computed<string | null>(
    () => Array.from(jobHistoryErrors.values()).join('; ') || null
  );
  let jobHistoryRequest: Promise<void> | null = null;
  const submittedContexts = reactive(new Map<string, SubmittedJobContext>());
  const jobResults = reactive(new Map<string, ProcessingResult[]>());
  const jobResultMissing = reactive(new Map<string, number>());
  const pollTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const pollRetries = new Map<string, number>();

  // Generation guards stop a late response from resurrecting a deleted job.
  let generationCounter = 0;
  const jobGenerations = new Map<string, number>();

  function mintGeneration(key: string): number {
    generationCounter += 1;
    jobGenerations.set(key, generationCounter);
    return generationCounter;
  }

  const isCurrent = (key: string, gen: number | undefined): boolean =>
    gen !== undefined && jobGenerations.get(key) === gen;

  // The Jobs component watches this to prompt a reload.
  const sessionExpired = ref(false);

  const completionListeners = new Set<CompletionListener>();
  // Retained so a listener that subscribes after the event, because the Jobs tab
  // was unmounted when the job finished, can be replayed on remount.
  const terminalCompletions = new Map<string, JobCompletion>();
  // Store-level rather than per-callback: the component re-subscribes with a
  // fresh callback every mount, so a per-callback set would double-fire.
  const firedCompletions = new Set<string>();
  const inFlightCompletions = new Set<string>();

  const providerCount = computed(() => configs.size);

  // Merged once here so every consumer (list, count, filter options) shares a
  // single durable+live merge per store change instead of re-merging.
  const jobHistoryRows = computed(() =>
    selectJobHistoryRows(
      Array.from(jobHistory.values()),
      jobs,
      submittedContexts
    )
  );

  // A provider id encodes its launch context, so re-registering one id with a
  // different config must never silently swap a live instance's config.
  function registerProviderConfig(config: ProcessingProviderConfig) {
    const existing = configs.get(config.id);
    if (existing) {
      if (deepEqual(existing, config)) return;
      throw new Error(
        `Processing provider "${config.id}" is already registered with a different configuration`
      );
    }
    // Read before registering: boot-time registrations precede the one-time
    // adoption and must stay inert here.
    const historyStarted =
      jobHistoryComplete.value || jobHistoryRequest !== null;
    configs.set(config.id, config);
    if (historyStarted) {
      // A provider arriving after adoption must still discover its jobs.
      jobHistoryComplete.value = false;
      const prior = jobHistoryRequest ?? Promise.resolve();
      void prior
        .catch(() => {})
        .then(() => loadMoreJobHistory())
        .catch(() => {});
    }
  }

  // One list so deleteJob and clearJobs stay in lockstep.
  const perJobCollections: Array<{
    delete(key: string): unknown;
    clear(): void;
  }> = [
    jobs,
    jobHistory,
    jobHistoryDetails,
    submittedContexts,
    jobResults,
    jobResultMissing,
    jobGenerations,
    terminalCompletions,
    firedCompletions,
    inFlightCompletions,
  ];

  function clearJobs() {
    Array.from(pollTimers.keys()).forEach(stopPolling);
    perJobCollections.forEach((collection) => collection.clear());
    jobHistoryCursors.clear();
    jobHistoryErrors.clear();
    jobHistoryLoading.value = false;
    jobHistoryComplete.value = false;
    jobHistoryRequest = null;
    sessionExpired.value = false;
  }

  function clearProviders() {
    configs.clear();
    instances.clear();
    loading.clear();
    clearJobs();
  }

  async function getProvider(id: string): Promise<ProcessingProvider> {
    const existing = instances.get(id);
    if (existing) return existing;
    const inflight = loading.get(id);
    if (inflight) return inflight;
    const config = configs.get(id);
    if (!config) throw new Error(`Unknown provider id: ${id}`);
    const promise = loadProvider(config).then((provider) => {
      instances.set(id, provider);
      if (loading.get(id) === promise) loading.delete(id);
      return provider;
    });
    // Evict a rejected load so later calls retry instead of returning the same
    // dead promise.
    promise.catch(() => {
      if (loading.get(id) === promise) loading.delete(id);
    });
    loading.set(id, promise);
    return promise;
  }

  function recordJob(providerId: string, status: ProcessingJobStatus) {
    const key = jobKey({ providerId, jobId: status.jobId });
    // Skipping an unchanged write avoids rebuilding and re-sorting the JobList
    // `jobs` computed on every poll tick.
    const existing = jobs.get(key);
    if (existing && deepEqual(existing, status)) return;
    jobs.set(key, status);
  }

  function recordSubmittedContext(context: SubmittedJobContext) {
    const key = jobKey({
      providerId: context.providerId,
      jobId: context.jobId,
    });
    // Never re-mint a live generation: that would orphan the incarnation's own
    // in-flight continuations.
    if (!jobGenerations.has(key)) mintGeneration(key);
    submittedContexts.set(key, context);
  }

  // With no listener subscribed the completion is retained but not marked seen,
  // so the next subscriber replays it exactly once.
  function deliverCompletion(jobRef: TrackedJobRef, completion: JobCompletion) {
    // An already-retained completion means a second poll loop reached the
    // terminal state, so delivering again would double-toast.
    const key = jobKey(jobRef);
    if (terminalCompletions.has(key) || firedCompletions.has(key)) return;
    addTerminalJobMessage(jobRef, completion.status, completion.results);
    terminalCompletions.set(key, completion);
    if (completionListeners.size === 0) return;
    firedCompletions.add(key);
    completionListeners.forEach((cb) => cb(completion));
  }

  function onJobComplete(cb: CompletionListener): () => void {
    completionListeners.add(cb);
    terminalCompletions.forEach((completion, key) => {
      if (firedCompletions.has(key)) return;
      firedCompletions.add(key);
      cb(completion);
    });
    return () => completionListeners.delete(cb);
  }

  function stopPolling(key: string) {
    const timer = pollTimers.get(key);
    if (timer) clearTimeout(timer);
    pollTimers.delete(key);
    pollRetries.delete(key);
    // The polling epoch is over: advance the generation so a late getJob
    // continuation drops instead of re-recording over the terminal status.
    if (jobGenerations.has(key)) mintGeneration(key);
  }

  function scheduleNextPoll(
    provider: ProcessingProvider,
    jobId: string,
    delay: number
  ) {
    const key = jobKey({ providerId: provider.config.id, jobId });
    // Replace, never orphan: a second poll loop for the same job would leave an
    // untracked timer that stopPolling can no longer cancel.
    const existing = pollTimers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => pollOnce(provider, jobId), delay);
    pollTimers.set(key, timer);
  }

  function taskLabelFor(jobRef: TrackedJobRef): string {
    return submittedContexts.get(jobKey(jobRef))?.taskId ?? jobRef.jobId;
  }

  function addTerminalJobMessage(
    jobRef: TrackedJobRef,
    status: ProcessingJobStatus,
    results: ProcessingResult[]
  ) {
    const title = taskLabelFor(jobRef);
    const messageStore = useMessageStore();
    if (status.state === 'success') {
      const count = results.length;
      messageStore.addSuccess(
        `Job complete: ${title}`,
        `${count} result${count === 1 ? '' : 's'} available in the Jobs panel.`
      );
    } else if (status.state === 'error') {
      const failureTitle = /result/i.test(status.errorTail ?? '')
        ? `Job failed while fetching results: ${title}`
        : `Job failed: ${title}`;
      messageStore.addError(failureTitle, {
        details:
          status.errorTail?.trim() || missingJobErrorDetails(status.jobId),
      });
    } else if (status.state === 'cancelled') {
      messageStore.addInfo(`Job cancelled: ${title}`);
    }
  }

  // The synthesized error status routes through the same completion path as any
  // other terminal job.
  function failJob(
    jobRef: TrackedJobRef,
    err: unknown,
    detail?: string
  ): ProcessingJobStatus {
    stopPolling(jobKey(jobRef));
    const message = errorMessage(err);
    const errorTail = detail ? `${detail}: ${message}` : message;
    const status: ProcessingJobStatus = {
      jobId: jobRef.jobId,
      state: 'error',
      resultState: 'unavailable',
      errorTail,
    };
    recordJob(jobRef.providerId, status);
    return status;
  }

  // Same-origin means the whole backend session is gone, not just this job, so
  // there is no subtler recovery than a reload.
  function markSessionExpired(err: unknown) {
    if (sessionExpired.value) return;
    sessionExpired.value = true;
    Array.from(pollTimers.keys()).forEach(stopPolling);
    useMessageStore().addError(
      'Your session has expired. Reload the page to continue.',
      { error: err instanceof Error ? err : undefined, persist: true }
    );
  }

  function handlePollError(
    provider: ProcessingProvider,
    jobId: string,
    err: unknown
  ) {
    const jobRef: TrackedJobRef = { providerId: provider.config.id, jobId };
    const key = jobKey(jobRef);
    const kind = classifyError(err);
    if (kind === 'session-expired') {
      markSessionExpired(err);
      return;
    }
    if (kind === 'transient') {
      const attempts = (pollRetries.get(key) ?? 0) + 1;
      if (attempts <= MAX_POLL_RETRIES) {
        pollRetries.set(key, attempts);
        scheduleNextPoll(
          provider,
          jobId,
          Math.min(POLL_INTERVAL_MS * 2 ** attempts, MAX_POLL_BACKOFF_MS)
        );
        return;
      }
    }
    const detail =
      kind === 'resource-gone'
        ? 'the job or its base image may have been deleted'
        : kind === 'permanent'
          ? undefined
          : `polling gave up after ${MAX_POLL_RETRIES} retries`;
    const status = failJob(jobRef, err, detail);
    deliverCompletion(jobRef, {
      status,
      results: [],
      context: submittedContexts.get(key),
    });
  }

  function baseImageMissing(context?: SubmittedJobContext): boolean {
    const id = context?.activeDatasetId;
    if (!id) return false; // no base bound at submit — nothing to lose
    return !useDatasetStore().idsAsSelections.includes(id);
  }

  // An adopted job's persisted image input carries the parent's provenance URIs,
  // so the parent can be re-identified among the loaded datasets.
  function isImageInputValue(
    v: unknown
  ): v is { type: string; uris: string[] } {
    const parsed = inputValueSchema.safeParse(v);
    return parsed.success && parsed.data.type !== TYPE_TAG_LABELMAP;
  }

  // Order-insensitive: a re-loaded dataset's provenance walk need not enumerate
  // in submit order.
  function sameUriSet(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((uri) => b.includes(uri));
  }

  function datasetIdForUris(uris: string[]): string | undefined {
    const datasets = useDatasetStore();
    return datasets.idsAsSelections.find((id) =>
      sameUriSet(collectProvenanceUris(datasets.getDataSource(id)), uris)
    );
  }

  async function reconstructAdoptedParentId(
    provider: ProcessingProvider,
    jobId: string
  ): Promise<string | undefined> {
    let detail: JobHistoryDetail | undefined;
    try {
      detail = await provider.getJobHistoryDetail(jobId);
    } catch {
      return undefined; // best-effort: the open-as-dataset fallback still works
    }
    const imageInputs = Object.values(detail?.parameters ?? {}).filter(
      isImageInputValue
    );
    // Anything but exactly one image input is ambiguous; never guess a parent to
    // attach results to.
    if (imageInputs.length !== 1) return undefined;
    return datasetIdForUris(imageInputs[0].uris);
  }

  // Rebuild an adopted job's missing parent id so a labelmap result attaches
  // as a segment group instead of opening as a top-level dataset.
  async function ensureAdoptedParentId(
    provider: ProcessingProvider,
    key: string,
    gen: number | undefined,
    context: SubmittedJobContext | undefined
  ): Promise<SubmittedJobContext | undefined> {
    if (!context || context.activeDatasetId != null) return context;
    const parentId = await reconstructAdoptedParentId(provider, context.jobId);
    if (parentId === undefined || !isCurrent(key, gen)) return context;
    const updated = { ...context, activeDatasetId: parentId };
    submittedContexts.set(key, updated);
    return updated;
  }

  async function fireCompletion(
    provider: ProcessingProvider,
    status: ProcessingJobStatus
  ) {
    const { jobId } = status;
    const jobRef: TrackedJobRef = { providerId: provider.config.id, jobId };
    const key = jobKey(jobRef);
    if (
      inFlightCompletions.has(key) ||
      terminalCompletions.has(key) ||
      firedCompletions.has(key)
    )
      return;
    const gen = jobGenerations.get(key);
    if (gen === undefined) return;
    inFlightCompletions.add(key);
    let context = submittedContexts.get(key);
    try {
      if (status.state !== 'success') {
        context = await ensureAdoptedParentId(provider, key, gen, context);
        if (!isCurrent(key, gen)) return;
        deliverCompletion(jobRef, { status, results: [], context });
        return;
      }

      // A results-fetch error must never read as "succeeded, no outputs".
      let results: ProcessingResult[];
      let unresolvedOutputs: number;
      try {
        // The parent-id rebuild is independent of the results fetch, so the
        // two round trips run concurrently.
        const [bundle, updatedContext] = await Promise.all([
          provider.getResults(jobId),
          ensureAdoptedParentId(provider, key, gen, context),
        ]);
        context = updatedContext;
        results = bundle.results;
        unresolvedOutputs = bundle.missing;
      } catch (err) {
        if (classifyError(err) === 'session-expired') {
          markSessionExpired(err);
          return;
        }
        // Deleted mid-fetch: recreating the job as an error row would resurrect
        // it.
        if (!isCurrent(key, gen)) return;
        const errored = failJob(jobRef, err, 'failed to fetch job results');
        deliverCompletion(jobRef, { status: errored, results: [], context });
        return;
      }
      if (!isCurrent(key, gen)) return;
      jobResults.set(key, results);
      jobResultMissing.set(key, unresolvedOutputs);

      if (unresolvedOutputs > 0) warnMissingOutputs(unresolvedOutputs);

      const missing = baseImageMissing(context);
      if (missing) {
        const count = results.length;
        useMessageStore().addWarning(
          'Base image was closed before the job finished',
          {
            details: `${count} result${count === 1 ? '' : 's'} for this job are available in the Jobs panel but were not attached automatically.`,
          }
        );
      }
      deliverCompletion(jobRef, {
        status,
        results,
        context,
        baseImageMissing: missing,
      });
    } finally {
      // A delivered completion is owned by terminalCompletions; a pre-delivery
      // failure may be attempted again.
      inFlightCompletions.delete(key);
    }
  }

  async function pollOnce(provider: ProcessingProvider, jobId: string) {
    const key = jobKey({ providerId: provider.config.id, jobId });
    const gen = jobGenerations.get(key);
    let status: ProcessingJobStatus;
    try {
      status = await provider.getJob(jobId);
    } catch (err) {
      if (!isCurrent(key, gen)) return;
      handlePollError(provider, jobId, err);
      return;
    }
    if (!isCurrent(key, gen)) return;
    pollRetries.delete(key);
    recordJob(provider.config.id, status);
    if (completionReady(status)) {
      stopPolling(key);
      await fireCompletion(provider, status);
      return;
    }
    scheduleNextPoll(provider, jobId, POLL_INTERVAL_MS);
  }

  async function submitJob(
    providerId: string,
    taskId: string,
    values: Record<string, ProcessingValue>,
    submittedContext: Omit<
      SubmittedJobContext,
      'jobId' | 'submittedAt' | 'taskId' | 'providerId'
    >
  ): Promise<string> {
    try {
      const provider = await getProvider(providerId);
      const jobRef = await provider.runTask(taskId, values);
      const jobId = jobRef.jobId;
      recordSubmittedContext({
        jobId,
        taskId,
        providerId,
        submittedAt: new Date().toISOString(),
        ...submittedContext,
      });

      // A provider may hand back an already-terminal job: route it through the
      // completion path but never register a poller.
      const initialStatus: ProcessingJobStatus = jobRef.status
        ? { ...jobRef.status, jobId }
        : { jobId, state: 'pending', resultState: 'waiting' };
      recordJob(providerId, initialStatus);
      if (completionReady(initialStatus)) {
        await fireCompletion(provider, initialStatus);
        return jobId;
      }

      pollOnce(provider, jobId);
      return jobId;
    } catch (err) {
      // Re-thrown so the caller's form resets its submitting flag.
      useMessageStore().addError('Failed to submit job', {
        error: err instanceof Error ? err : undefined,
      });
      throw err;
    }
  }

  // Records no terminal status itself: cancel is best-effort, so the existing
  // poller stays the single source of convergence.
  async function cancelJob(jobRef: TrackedJobRef): Promise<boolean> {
    const context = submittedContexts.get(jobKey(jobRef));
    if (!context) return false;
    try {
      const provider = await getProvider(jobRef.providerId);
      await provider.cancelJob(jobRef.jobId);
      return true;
    } catch (err) {
      // Leave the poller running so a job that terminates on its own still
      // converges.
      if (classifyError(err) === 'session-expired') {
        markSessionExpired(err);
        return false;
      }
      useMessageStore().addError('Failed to cancel job', {
        error: err instanceof Error ? err : undefined,
      });
      return false;
    }
  }

  async function deleteJob(jobRef: TrackedJobRef) {
    const key = jobKey(jobRef);
    const context = submittedContexts.get(key);
    if (!context) return;
    // Re-minting rather than removing keeps the job tracked if the server delete
    // fails below.
    mintGeneration(key);
    stopPolling(key);
    try {
      const provider = await getProvider(jobRef.providerId);
      await provider.deleteJob(jobRef.jobId);
      // Leaving completion bookkeeping behind would suppress a recycled jobId as
      // already-delivered and leak its retained JobCompletion.
      perJobCollections.forEach((collection) => collection.delete(key));
    } catch (err) {
      useMessageStore().addError('Failed to delete job', {
        error: err instanceof Error ? err : undefined,
      });
    }
  }

  // A job that finished while VolView was closed never ran the live-completion
  // path, so its results are not in `jobResults`.
  async function loadJobResults(jobRef: TrackedJobRef) {
    const key = jobKey(jobRef);
    if (jobResults.has(key)) return;
    const context = submittedContexts.get(key);
    if (!context) return;
    // A delete landing while this fetch is in flight must not commit results or
    // an error toast afterward.
    const gen = jobGenerations.get(key);
    try {
      const provider = await getProvider(jobRef.providerId);
      // The parent-id rebuild is independent of the results fetch, so the two
      // round trips run concurrently.
      const [bundle] = await Promise.all([
        provider.getResults(jobRef.jobId),
        ensureAdoptedParentId(provider, key, gen, context),
      ]);
      if (!isCurrent(key, gen)) return;
      jobResults.set(key, bundle.results);
      jobResultMissing.set(key, bundle.missing);
      if (bundle.missing > 0) warnMissingOutputs(bundle.missing);
    } catch (err) {
      if (classifyError(err) === 'session-expired') {
        markSessionExpired(err);
        return;
      }
      if (!isCurrent(key, gen)) return;
      useMessageStore().addError('Failed to load job results', {
        error: err instanceof Error ? err : undefined,
      });
    }
  }

  async function loadJobHistoryDetail(jobRef: TrackedJobRef) {
    const key = jobKey(jobRef);
    if (jobHistoryDetails.has(key)) return;
    const context = submittedContexts.get(key);
    if (!context) return;
    const gen = jobGenerations.get(key);
    try {
      const provider = await getProvider(jobRef.providerId);
      const detail = await provider.getJobHistoryDetail(jobRef.jobId);
      if (!isCurrent(key, gen)) return;
      jobHistoryDetails.set(key, detail);
    } catch (err) {
      if (!isCurrent(key, gen)) return;
      useMessageStore().addError('Failed to load job details', {
        error: err instanceof Error ? err : undefined,
      });
    }
  }

  // Terminal summaries are observability rows only; non-terminal ones join the
  // normal poller so jobs that finish while open keep the live-result behavior.
  async function adoptDiscoveredJob(
    provider: ProcessingProvider,
    providerId: string,
    summary: JobHistorySummary
  ) {
    const jobRef: TrackedJobRef = { providerId, jobId: summary.jobId };
    const key = jobKey(jobRef);
    jobHistory.set(key, { ...summary, providerId });
    // An in-session submit already owns it.
    if (submittedContexts.has(key) || jobs.has(key)) return;

    recordSubmittedContext({
      jobId: summary.jobId,
      taskId: summary.taskId,
      providerId,
      submittedAt: summary.createdAt,
      display: { taskTitle: summary.taskTitle, parameters: [] },
    });
    // A clearJobs or deleteJob landing while the getJob below is in flight must
    // not re-record the adopted job.
    const gen = jobGenerations.get(key);

    if (isTerminalJobState(summary.state)) {
      recordJob(providerId, {
        jobId: summary.jobId,
        state: summary.state,
        resultState: summary.resultState,
        ...(summary.progress != null ? { progress: summary.progress } : {}),
      });
      return;
    }

    let status: ProcessingJobStatus;
    try {
      status = await provider.getJob(summary.jobId);
    } catch (err) {
      if (classifyError(err) === 'session-expired') markSessionExpired(err);
      return; // never fabricate a state for a re-discovered job
    }
    if (!isCurrent(key, gen)) return;
    recordJob(providerId, status);
    if (completionReady(status)) {
      await fireCompletion(provider, status);
      return;
    }
    // scheduleNextPoll, not pollOnce: the status above is already fresh.
    scheduleNextPoll(provider, summary.jobId, POLL_INTERVAL_MS);
  }

  async function loadProviderJobHistory(providerId: string) {
    let provider: ProcessingProvider;
    try {
      provider = await getProvider(providerId);
    } catch (err) {
      jobHistoryErrors.set(
        providerId,
        errorMessage(err, 'Failed to load job history')
      );
      return;
    }
    const cursor = jobHistoryCursors.get(providerId) ?? undefined;
    try {
      const page = await provider.listJobHistory(cursor);
      jobHistoryCursors.set(providerId, page.nextCursor);
      jobHistoryErrors.delete(providerId);
      await Promise.all(
        page.jobs.map((summary) =>
          adoptDiscoveredJob(provider, providerId, summary)
        )
      );
    } catch (err) {
      console.error('Job re-discovery failed', err);
      jobHistoryErrors.set(
        providerId,
        errorMessage(err, 'Failed to load job history')
      );
    }
  }

  async function loadMoreJobHistory() {
    if (jobHistoryComplete.value) return;
    if (jobHistoryRequest) return jobHistoryRequest;
    jobHistoryRequest = (async () => {
      jobHistoryLoading.value = true;
      const pending = Array.from(configs.keys()).filter(
        (providerId) => jobHistoryCursors.get(providerId) !== null
      );
      await Promise.all(pending.map(loadProviderJobHistory));
      jobHistoryComplete.value = Array.from(configs.keys()).every(
        (providerId) => jobHistoryCursors.get(providerId) === null
      );
    })();
    try {
      await jobHistoryRequest;
    } finally {
      jobHistoryLoading.value = false;
      jobHistoryRequest = null;
    }
  }

  // The leading fetch doubles as the retry after an error.
  async function loadAllJobHistory() {
    do {
      await loadMoreJobHistory();
    } while (!jobHistoryComplete.value && jobHistoryError.value == null);
  }

  async function adoptJobHistory() {
    jobHistoryCursors.clear();
    jobHistoryErrors.clear();
    jobHistoryComplete.value = configs.size === 0;
    await loadMoreJobHistory();
  }

  return {
    configs,
    instances,
    jobs,
    jobHistory,
    jobHistoryRows,
    jobHistoryDetails,
    jobHistoryLoading,
    jobHistoryComplete,
    jobHistoryError,
    jobResults,
    jobResultMissing,
    submittedContexts,
    providerCount,
    sessionExpired,

    registerProviderConfig,
    clearProviders,
    getProvider,
    recordJob,
    recordSubmittedContext,
    submitJob,
    cancelJob,
    deleteJob,
    loadJobResults,
    loadJobHistoryDetail,
    onJobComplete,
    stopPolling,
    adoptJobHistory,
    loadMoreJobHistory,
    loadAllJobHistory,
  };
});
