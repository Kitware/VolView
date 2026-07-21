// Processing providers store.
//
// Holds provider *configs* (registered on app boot from the manifest config
// JSON) and *instances* (created lazily on first `getProvider` call —
// dynamic-imports the generic engine provider chunk).
//
// Also owns the whole tracked-job lifecycle: the submitted-job records, the poll
// loop, the terminal completion firing, and — the in-session durability half — a
// store-level replay so a job that finishes while the Jobs tab is unmounted still
// fires its side effects exactly once when the tab remounts. The record +
// machinery live HERE (not in the Jobs component) so they survive an unmount /
// tab-switch / layout change. Completion replay is in-memory ONLY — it
// deliberately does NOT survive a page reload; after a reload, job-history
// adoption repopulates the Jobs panel + poller.

import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import deepEqual from 'fast-deep-equal';

import type { JobHistoryDetail, JobHistorySummary } from '@/backend-contract';
import { TYPE_TAG_LABELMAP } from '@/backend-contract';
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
// A durable job-history row carries the provider that produced it so the client
// can key it by (providerId, jobId) — two folder-scoped providers may mint the
// same raw jobId. Defined once in the engine; reused here.
import type { TrackedJobHistorySummary } from '@/src/processing/engine/jobHistory';
import { useMessageStore } from '@/src/store/messages';
import { useDatasetStore } from '@/src/store/datasets';

// ---------------------------------------------------------------------------
// Lifecycle tuning constants
// ---------------------------------------------------------------------------

export const POLL_INTERVAL_MS = 2000;
// Bounded transient-error retries before a poll gives up and fails the job loud
// (item 3 — never an infinite quiet loop). Counts CONSECUTIVE transient errors;
// any successful poll resets it.
export const MAX_POLL_RETRIES = 4;
// Ceiling on the exponential poll backoff so a long-lived transient outage never
// stretches the retry interval without bound.
export const MAX_POLL_BACKOFF_MS = 30000;

const completionReady = (status: ProcessingJobStatus): boolean =>
  isTerminalJobState(status.state);

// ---------------------------------------------------------------------------
// Poll/results error classification
//
// The engine transport throws an `Error` carrying the HTTP `status` (see
// engine/transport.ts). We fail LOUD but discriminate so the poll loop retries
// only what is genuinely transient:
//   * 401 / 403       → session/auth expiry — the whole same-origin session is
//                       dead (item 7). Stop everything, prompt a reload.
//   * 404 / 410       → the job or its base image is gone (item 8, server half).
//   * other 4xx       → permanent — the request is malformed/forbidden; no retry.
//   * 5xx / no status → transient — a network blip or server hiccup; retry with
//                       backoff up to MAX_POLL_RETRIES, then fail the job.
// ---------------------------------------------------------------------------

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
  // 5xx or no HTTP status (fetch rejected — offline / DNS / CORS) → transient.
  return 'transient';
};

const errorMessage = (err: unknown, fallback?: string): string =>
  err instanceof Error ? err.message : (fallback ?? String(err));

// A success whose backend could not resolve every recorded output (deleted /
// unreadable files) is a PARTIAL loss: warn with the count without dropping the
// results that did resolve. One helper for the live-completion and the
// on-demand history-fetch paths so their wording cannot drift.
const warnMissingOutputs = (n: number): void => {
  const plural = n === 1 ? '' : 's';
  useMessageStore().addWarning(`${n} output${plural} could not be retrieved`, {
    details: `${n} of this job's recorded output${plural} could not be retrieved (deleted or unreadable). The results that resolved are available in the Jobs panel.`,
  });
};

// ---------------------------------------------------------------------------
// Completion payload
//
// A single object (functional, extensible) delivered to every completion
// listener. `baseImageMissing` flags item 8: the originating base image was
// removed before the job finished, so results must be surfaced (never silently
// dropped) but not auto-attached to a parent that no longer exists.
// ---------------------------------------------------------------------------

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
  // Dynamic import — Vite emits a separate chunk for the generic engine that's
  // only fetched when some surface (typically the Jobs tab) actually
  // instantiates a provider, keeping the engine out of the boot bundle. There
  // is one generic engine and no per-backend branch: every provider is the
  // engine transport reading the neutral-backend default descriptor.
  const { createProvider } =
    await import('@/src/processing/engine/createProvider');
  return createProvider(config);
};

export const useProcessingJobsStore = defineStore('processingJobs', () => {
  // Configs are populated on app boot from the manifest config.
  const configs = reactive(new Map<string, ProcessingProviderConfig>());

  // Provider instances are created lazily on first request.
  const instances = reactive(new Map<string, ProcessingProvider>());
  const loading = reactive(new Map<string, Promise<ProcessingProvider>>());

  // Job tracking — populated when the user submits a task. EVERY per-job
  // collection below is keyed by `jobKey({ providerId, jobId })`, never a raw
  // jobId: two folder-scoped providers may mint the same raw jobId, and a raw-id
  // key would collide them.
  const jobs = reactive(new Map<string, ProcessingJobStatus>());
  const jobHistory = reactive(new Map<string, TrackedJobHistorySummary>());
  const jobHistoryDetails = reactive(new Map<string, JobHistoryDetail>());
  const jobHistoryCursors = new Map<string, string | null>();
  const jobHistoryLoading = ref(false);
  const jobHistoryComplete = ref(false);
  // Per-provider load errors; the single user-facing string is derived from them
  // so the three former hand-derivations can never drift. Empty map → null.
  const jobHistoryErrors = reactive(new Map<string, string>());
  const jobHistoryError = computed<string | null>(
    () => Array.from(jobHistoryErrors.values()).join('; ') || null
  );
  let jobHistoryRequest: Promise<void> | null = null;
  const submittedContexts = reactive(new Map<string, SubmittedJobContext>());
  const jobResults = reactive(new Map<string, ProcessingResult[]>());
  const jobResultMissing = reactive(new Map<string, number>());
  const pollTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Per-job count of consecutive transient poll errors (bounded-retry backoff).
  const pollRetries = new Map<string, number>();

  // -------------------------------------------------------------------------
  // Per-job lifecycle generation (commit-if-current)
  //
  // THE one stale-async guard in this store. Every tracked job carries a
  // generation stamped from a store-global counter. It advances when the job's
  // lifecycle epoch changes — tracked (submit/adoption), polling stopped,
  // delete requested — and the entry disappears entirely on delete/clear. A
  // continuation captures the generation BEFORE its `await` and commits state
  // afterward only if the generation is unchanged, so a job that was deleted
  // (or an epoch that ended) while a request was in flight can never be
  // resurrected by the late response. The global counter (never per-key
  // restarts) means a re-tracked job mints a generation no stale continuation
  // can ever hold.
  // -------------------------------------------------------------------------
  let generationCounter = 0;
  const jobGenerations = new Map<string, number>();

  function mintGeneration(key: string): number {
    generationCounter += 1;
    jobGenerations.set(key, generationCounter);
    return generationCounter;
  }

  const isCurrent = (key: string, gen: number | undefined): boolean =>
    gen !== undefined && jobGenerations.get(key) === gen;

  // Set once when a mid-job request meets 401/403: the same-origin session is
  // dead. The Jobs component watches this to prompt a reload (item 7).
  const sessionExpired = ref(false);

  // Subscribers fired when a job reaches a terminal state with its results.
  // Used by the Jobs component to load result files + toast (Phase 5).
  const completionListeners = new Set<CompletionListener>();
  // The last terminal completion for each job, retained so a listener that
  // subscribes AFTER the event (the Jobs tab was unmounted when the job
  // finished) can be replayed on remount. In-memory only.
  const terminalCompletions = new Map<string, JobCompletion>();
  // Store-level seen-set: jobIds whose completion has already been delivered to
  // a listener. This is what makes replay fire each job's side effects EXACTLY
  // ONCE across tab unmount/remount — the component re-subscribes with a FRESH
  // callback every mount, so a per-callback set (the old component-local
  // `seenToastJobs`) would double-fire. Never persisted (a reload re-discovers).
  const firedCompletions = new Set<string>();
  const inFlightCompletions = new Set<string>();

  // Reactive counter so components can `v-if="providers.providerCount > 0"`.
  // Derived from the reactive configs map — never hand-synced.
  const providerCount = computed(() => configs.size);

  // Provider registration is IMMUTABLE. A provider id encodes its launch folder,
  // so re-registering the same id must never silently swap a live instance's
  // config (that recreates the mutable-identity problem in a subtler form):
  //   * first registration stores the config;
  //   * a structurally equal duplicate is a no-op;
  //   * the same id with a different config is a configuration error;
  //   * a new folder always yields a new id and a fresh instance.
  function registerProviderConfig(config: ProcessingProviderConfig) {
    const existing = configs.get(config.id);
    if (existing) {
      if (deepEqual(existing, config)) return;
      throw new Error(
        `Processing provider "${config.id}" is already registered with a different configuration`
      );
    }
    configs.set(config.id, config);
  }

  // Single source of truth for per-job (jobId-keyed) state, so deleteJob (one
  // id) and clearJobs (all) stay in lockstep — this list silently drifting was
  // the item-6 bug. Pollers live in pollTimers/pollRetries, owned by stopPolling.
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

  // Drop every tracked job + its pollers and reset the non-per-job history
  // scalars. Split out so a provider reset wipes in-flight jobs rather than
  // leaking their pollers and stale records.
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
    // Provider loading must be retryable: a rejected load must not be left in
    // `loading` forever (every later getProvider would return the same dead
    // promise). Evict it on failure — but only if it is still the current
    // in-flight promise — then rethrow so this caller still sees the error.
    promise.catch(() => {
      if (loading.get(id) === promise) loading.delete(id);
    });
    loading.set(id, promise);
    return promise;
  }

  function recordJob(providerId: string, status: ProcessingJobStatus) {
    const key = jobKey({ providerId, jobId: status.jobId });
    // Every 2s poll calls this even when nothing changed. Skipping a deep-equal
    // write avoids re-running the JobList `jobs` computed (a full history-row
    // rebuild + sort) each tick for a job whose status is identical.
    const existing = jobs.get(key);
    if (existing && deepEqual(existing, status)) return;
    jobs.set(key, status);
  }

  function recordSubmittedContext(context: SubmittedJobContext) {
    const key = jobKey({
      providerId: context.providerId,
      jobId: context.jobId,
    });
    // A job becomes tracked here (submit or history adoption): mint this
    // incarnation's lifecycle generation. Never re-mint a live one — that
    // would orphan the incarnation's own in-flight continuations.
    if (!jobGenerations.has(key)) mintGeneration(key);
    submittedContexts.set(key, context);
  }

  // -------------------------------------------------------------------------
  // Completion delivery + in-session replay
  // -------------------------------------------------------------------------

  // Deliver a terminal completion to current listeners, retain it for replay,
  // and mark it seen. If NO listener is subscribed (Jobs tab unmounted) the
  // completion is retained but NOT marked seen, so the next `onJobComplete`
  // subscriber replays it — exactly once.
  function deliverCompletion(jobRef: TrackedJobRef, completion: JobCompletion) {
    // A completion already retained (or already fired) means a second poll
    // loop reached the terminal state — e.g. boot adoption overlapping an
    // in-flight submit. Delivering it again would double-toast and re-fire
    // every listener's side effects.
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
    // Replay every terminal completion this store has not yet delivered to a
    // listener. Marking as we go keeps a subsequent remount from re-firing.
    terminalCompletions.forEach((completion, key) => {
      if (firedCompletions.has(key)) return;
      firedCompletions.add(key);
      cb(completion);
    });
    return () => completionListeners.delete(cb);
  }

  // -------------------------------------------------------------------------
  // Timer + error lifecycle
  // -------------------------------------------------------------------------

  // Keyed by jobKey (the poll collections are all composite-keyed). Callers pass
  // jobKey(jobRef); clearJobs/markSessionExpired pass the keys straight from
  // pollTimers.keys().
  function stopPolling(key: string) {
    const timer = pollTimers.get(key);
    if (timer) clearTimeout(timer);
    pollTimers.delete(key);
    // Per-job transient bookkeeping is dropped on terminal/stop (item 6).
    pollRetries.delete(key);
    // The polling epoch is over: advance the generation so any in-flight poll
    // continuation (an overlapping loop's late getJob) drops instead of
    // re-recording state over the terminal status. The job stays tracked.
    if (jobGenerations.has(key)) mintGeneration(key);
  }

  function scheduleNextPoll(
    provider: ProcessingProvider,
    jobId: string,
    delay: number
  ) {
    const key = jobKey({ providerId: provider.config.id, jobId });
    // Replace, never orphan: a second poll loop for the same job (boot
    // adoption vs in-flight submit) would otherwise leave an untracked timer
    // that stopPolling can no longer cancel.
    const existing = pollTimers.get(key);
    if (existing) clearTimeout(existing);
    // The timer callback still polls with the RAW jobId — that is what the
    // provider transport addresses.
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

  // Fail LOUD: synthesize a terminal `error` status and route it through the
  // same completion path as any other terminal job so JobList shows it and the
  // terminal-message path surfaces it. `detail` prefixes the surfaced tail.
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

  // The session is dead (401/403). Stop ALL polling and surface a persistent,
  // reload-me message once (item 7). Same-origin means no subtler recovery —
  // the whole Girder session, not just this job, is gone.
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
    // transient — bounded retries with exponential backoff before failing loud.
    // Only this branch survives the poll; every other kind (and an exhausted
    // transient) falls through to the shared fail-and-deliver tail below.
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
    // resource-gone / permanent / retries-exhausted are all terminal failures
    // that deliver an empty completion — only the surfaced detail differs.
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

  // -------------------------------------------------------------------------
  // Terminal completion (result-read gating, items 5 + 8)
  // -------------------------------------------------------------------------

  // Item 8 (client half): the originating base image was removed mid-job. Its
  // id was recorded at submit but is gone from the dataset store now.
  function baseImageMissing(context?: SubmittedJobContext): boolean {
    const id = context?.activeDatasetId;
    if (!id) return false; // no base bound at submit — nothing to lose
    return !useDatasetStore().idsAsSelections.includes(id);
  }

  // -------------------------------------------------------------------------
  // Adopted-job parent reconstruction (reload durability)
  //
  // An adopted job's context carries no activeDatasetId — the parent binding
  // lived in the closed session's memory. The submitted parameters ARE
  // persisted server-side though, and the image input value they carry was
  // minted VERBATIM from the parent volume's own provenance URIs, so the
  // parent can be re-identified among the currently loaded datasets by
  // matching those URIs. Resolution is lazy (at completion, when the resumed
  // session's datasets are loaded) and fail-closed: no match / ambiguous
  // parameters / detail-fetch failure all yield undefined, keeping the
  // open-as-dataset fallback.
  // -------------------------------------------------------------------------

  function isImageInputValue(
    v: unknown
  ): v is { type: string; uris: string[] } {
    if (typeof v !== 'object' || v === null) return false;
    const candidate = v as { type?: unknown; uris?: unknown };
    return (
      typeof candidate.type === 'string' &&
      candidate.type !== TYPE_TAG_LABELMAP &&
      Array.isArray(candidate.uris) &&
      candidate.uris.length > 0 &&
      candidate.uris.every((u) => typeof u === 'string')
    );
  }

  // Order-insensitive equality: the URIs are round-tripped verbatim, but the
  // re-loaded dataset's provenance walk need not enumerate in submit order.
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
      return undefined; // best-effort — the fallback path still works
    }
    const imageInputs = Object.values(detail?.parameters ?? {}).filter(
      isImageInputValue
    );
    // Exactly one persisted image input identifies the parent; anything else
    // is ambiguous — never guess a parent to attach results to.
    if (imageInputs.length !== 1) return undefined;
    return datasetIdForUris(imageInputs[0].uris);
  }

  // Shared terminal-completion path. Reached from both the poller and the
  // born-terminal fast-path in `submitJob`, so a synchronous job lands results
  // identically to a polled one. Assumes `status.state` is already terminal.
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
    // Commit-if-current: an untracked (already deleted) job has no generation
    // and delivers nothing; a tracked one captures its generation here so the
    // post-getResults continuation can prove the job wasn't deleted mid-fetch.
    const gen = jobGenerations.get(key);
    if (gen === undefined) return;
    inFlightCompletions.add(key);
    let context = submittedContexts.get(key);
    try {
      // Reload durability: an adopted job finished in THIS session but was
      // submitted by a closed one, so its context has no parent id. Rebuild it
      // from the persisted input provenance so a labelmap result attaches as a
      // segment group instead of opening as a top-level dataset.
      if (context && context.activeDatasetId == null) {
        const parentId = await reconstructAdoptedParentId(provider, jobId);
        if (parentId !== undefined && isCurrent(key, gen)) {
          context = { ...context, activeDatasetId: parentId };
          submittedContexts.set(key, context);
        }
      }
      // Item 5: result reads gate on terminal SUCCESS. A non-success terminal
      // (error/cancelled) delivers no results — but is never confused with an
      // empty success because the status travels with it.
      if (status.state !== 'success') {
        deliverCompletion(jobRef, { status, results: [], context });
        return;
      }

      // Item 5: a results-fetch error is an ERROR, never empty results. On
      // failure mark the job errored (loud) and deliver the errored status — the
      // old `notify([])` conflated "fetch failed" with "succeeded, no outputs".
      let results: ProcessingResult[];
      let unresolvedOutputs: number;
      try {
        const bundle = await provider.getResults(jobId);
        results = bundle.results;
        unresolvedOutputs = bundle.missing;
      } catch (err) {
        if (classifyError(err) === 'session-expired') {
          markSessionExpired(err);
          return;
        }
        // Deleted mid-fetch: dropping is correct — recreating the job as an
        // error row would resurrect it.
        if (!isCurrent(key, gen)) return;
        const errored = failJob(jobRef, err, 'failed to fetch job results');
        deliverCompletion(jobRef, { status: errored, results: [], context });
        return;
      }
      // Deleted mid-fetch: never repopulate jobResults/terminalCompletions for
      // a job the user removed while getResults was in flight.
      if (!isCurrent(key, gen)) return;
      jobResults.set(key, results);
      jobResultMissing.set(key, unresolvedOutputs);

      // The backend reports outputs it could not resolve (deleted / unreadable
      // files) as a `missing` count on the results envelope. A non-zero
      // count on a success is a PARTIAL loss — surface it as a warning ALONGSIDE the
      // results that did resolve (they still apply below). Distinct from the
      // `baseImageMissing` signal (base image closed mid-job) computed just below —
      // a different concept in this same completion path.
      if (unresolvedOutputs > 0) warnMissingOutputs(unresolvedOutputs);

      // Item 8: base image removed mid-job → detect + message; results are still
      // recorded (JobList shows them) and delivered, never silently dropped.
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
      // A delivered completion is now owned by terminalCompletions; a
      // retryable pre-delivery failure may be attempted again.
      inFlightCompletions.delete(key);
    }
  }

  async function pollOnce(provider: ProcessingProvider, jobId: string) {
    const key = jobKey({ providerId: provider.config.id, jobId });
    // Commit-if-current: capture the generation before the request. deleteJob/
    // clearJobs/stopPolling can all land while getJob is in flight; without
    // the re-check, failJob + deliverCompletion would resurrect a deleted job
    // with a spurious "Job failed" toast, and the success path would re-record
    // a stale status and schedule an untracked poller.
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
    // Any successful poll resets the transient-error backoff.
    pollRetries.delete(key);
    recordJob(provider.config.id, status);
    if (completionReady(status)) {
      stopPolling(key);
      await fireCompletion(provider, status);
      return;
    }
    scheduleNextPoll(provider, jobId, POLL_INTERVAL_MS);
  }

  // -------------------------------------------------------------------------
  // Submit (item 4 — surface failure, never swallow to console)
  // -------------------------------------------------------------------------

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

      // Async-with-sync-fast-path: a provider may hand back a
      // job that is already terminal. Record its real state and route it
      // through the same completion path as a polled job, but never register a
      // poller. Polling stays the driver only for jobs not yet terminal.
      const initialStatus: ProcessingJobStatus = jobRef.status
        ? { ...jobRef.status, jobId }
        : { jobId, state: 'pending', resultState: 'waiting' };
      recordJob(providerId, initialStatus);
      if (completionReady(initialStatus)) {
        await fireCompletion(provider, initialStatus);
        return jobId;
      }

      // Immediate first poll, then self-scheduling with backoff on error.
      pollOnce(provider, jobId);
      return jobId;
    } catch (err) {
      // Item 4: submit failure is surfaced in the UI, not swallowed to a
      // console.error. Re-thrown so the caller's form resets its submitting
      // flag and can distinguish success from failure.
      useMessageStore().addError('Failed to submit job', {
        error: err instanceof Error ? err : undefined,
      });
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Cancel (best-effort)
  // -------------------------------------------------------------------------

  // Request cancellation of a tracked job. One neutral engine call — no Girder
  // route/id/JobStatus knowledge here. Deliberately does NOT record a terminal
  // status itself: cancel is best-effort (the job may finish before the cancel
  // lands), so the EXISTING poller stays the single source of convergence and
  // fires completion exactly once on whatever terminal state the backend
  // reports. A cancel of an unknown/untracked job is a no-op (fail closed,
  // never throws to the UI).
  async function cancelJob(jobRef: TrackedJobRef) {
    const context = submittedContexts.get(jobKey(jobRef));
    if (!context) return;
    try {
      const provider = await getProvider(jobRef.providerId);
      await provider.cancelJob(jobRef.jobId);
    } catch (err) {
      // Best-effort: surface the failure but leave the poller running so a job
      // that terminates on its own still converges. A mid-cancel 401/403 is the
      // same dead-session signal the poller uses.
      if (classifyError(err) === 'session-expired') {
        markSessionExpired(err);
        return;
      }
      useMessageStore().addError('Failed to cancel job', {
        error: err instanceof Error ? err : undefined,
      });
    }
  }

  async function deleteJob(jobRef: TrackedJobRef) {
    const key = jobKey(jobRef);
    const context = submittedContexts.get(key);
    if (!context) return;
    // Tombstone-on-intent: advance the generation SYNCHRONOUSLY so every
    // continuation already in flight (a deferred getResults, a late poll)
    // drops instead of resurrecting the row mid-delete. Re-minting (not
    // removing) keeps the job tracked: if the server delete fails below, the
    // row survives and later reads capture the new, still-current generation.
    mintGeneration(key);
    stopPolling(key);
    try {
      const provider = await getProvider(jobRef.providerId);
      await provider.deleteJob(jobRef.jobId);
      // Forget every per-job record in one place (item 6) — the shared list
      // keeps this in lockstep with clearJobs. Leaving the completion
      // bookkeeping behind would suppress a recycled jobId as already-delivered
      // and leak its retained JobCompletion for the session.
      perJobCollections.forEach((collection) => collection.delete(key));
    } catch (err) {
      useMessageStore().addError('Failed to delete job', {
        error: err instanceof Error ? err : undefined,
      });
    }
  }

  // On-demand results fetch for the explicit historical-apply UI: a job that
  // finished while VolView was closed (adopted from history) never ran the
  // live-completion path, so its results are not in `jobResults`. Fetch them
  // through the SAME `getResults` provider call the live flow uses — one
  // result-read path, no second applier. Idempotent: a job already fetched
  // (live-completed or previously loaded) short-circuits.
  async function loadJobResults(jobRef: TrackedJobRef) {
    const key = jobKey(jobRef);
    if (jobResults.has(key)) return;
    const context = submittedContexts.get(key);
    if (!context) return;
    // Commit-if-current: a delete that lands while this fetch is in flight
    // must not have its results (or an error toast) committed afterward.
    const gen = jobGenerations.get(key);
    try {
      const provider = await getProvider(jobRef.providerId);
      const bundle = await provider.getResults(jobRef.jobId);
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
    // Commit-if-current (same stale-read rule as loadJobResults).
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

  // -------------------------------------------------------------------------
  // Complete job history is paged from existing backend jobs. Terminal
  // summaries are observability rows only; non-terminal summaries join the
  // normal poller so jobs that finish while open keep the live-result behavior.
  // -------------------------------------------------------------------------

  async function adoptDiscoveredJob(
    provider: ProcessingProvider,
    providerId: string,
    summary: JobHistorySummary
  ) {
    const jobRef: TrackedJobRef = { providerId, jobId: summary.jobId };
    const key = jobKey(jobRef);
    // History adoption attaches the provider that produced the row so the UI
    // can key it by (providerId, jobId) too.
    jobHistory.set(key, { ...summary, providerId });
    // Already tracked this session (an in-session submit owns it) → do not re-adopt.
    if (submittedContexts.has(key) || jobs.has(key)) return;

    recordSubmittedContext({
      jobId: summary.jobId,
      taskId: summary.taskId,
      providerId,
      submittedAt: summary.createdAt,
      display: { taskTitle: summary.taskTitle, parameters: [] },
    });
    // Commit-if-current for the live re-fetch below: a clearJobs/deleteJob
    // landing while getJob is in flight must not re-record the adopted job.
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

    // Still running from a prior page life: adopt it into the normal poller so
    // it finishes THIS session through the ordinary in-session live path.
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
    // scheduleNextPoll (not pollOnce) avoids an immediate re-fetch — we
    // already have a fresh status.
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

  async function loadAllJobHistory() {
    while (!jobHistoryComplete.value && jobHistoryError.value == null) {
      await loadMoreJobHistory();
    }
  }

  async function retryJobHistory() {
    await loadMoreJobHistory();
    if (jobHistoryError.value == null) await loadAllJobHistory();
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
    clearJobs,
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
    retryJobHistory,
  };
});
