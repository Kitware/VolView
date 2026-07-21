<template>
  <div>
    <!-- ----------------------------------------------------------------- -->
    <!-- Filters (collapsed by default)                                    -->
    <!-- ----------------------------------------------------------------- -->
    <div class="d-flex align-center">
      <v-btn
        size="small"
        variant="text"
        class="px-1"
        :prepend-icon="filtersOpen ? 'mdi-chevron-down' : 'mdi-chevron-right'"
        @click="filtersOpen = !filtersOpen"
      >
        Filter{{ activeFilterCount ? ` (${activeFilterCount})` : '' }}
      </v-btn>
      <v-spacer />
      <v-btn
        v-if="hasFilters"
        size="small"
        variant="text"
        @click="clearFilters"
      >
        Clear
      </v-btn>
    </div>
    <v-expand-transition>
      <div v-show="filtersOpen" class="job-filters mb-2">
        <v-text-field
          v-model="filters.text"
          label="Search jobs"
          density="compact"
          hide-details
        />
        <v-select
          v-model="filters.statuses"
          :items="statusItems"
          label="Status"
          multiple
          clearable
          density="compact"
          hide-details
        />
        <v-text-field
          v-model="filters.task"
          label="Task"
          density="compact"
          hide-details
        />
        <v-text-field
          v-model="filters.after"
          label="After"
          type="date"
          density="compact"
          hide-details
        />
        <v-text-field
          v-model="filters.before"
          label="Before"
          type="date"
          density="compact"
          hide-details
        />
        <v-select
          v-model="filters.timeField"
          :items="timeFieldItems"
          label="Time field"
          density="compact"
          hide-details
        />
        <v-checkbox
          v-model="filters.outputHealth"
          label="Missing outputs"
          true-value="missing"
          :false-value="undefined"
          density="compact"
          hide-details
        />
      </div>
    </v-expand-transition>

    <div
      v-if="hasFilters && !providers.jobHistoryComplete"
      class="text-caption text-medium-emphasis mb-2"
    >
      Loading complete history before filtering…
    </div>
    <div v-if="providers.jobHistoryError" class="text-error text-caption mb-2">
      {{ providers.jobHistoryError }}
      <v-btn
        size="x-small"
        variant="text"
        :loading="providers.jobHistoryLoading"
        @click="providers.retryJobHistory()"
      >
        Retry
      </v-btn>
    </div>

    <!-- ----------------------------------------------------------------- -->
    <!-- Selection header (batch delete)                                   -->
    <!-- ----------------------------------------------------------------- -->
    <div v-if="jobs.length" class="d-flex align-center selection-header">
      <v-checkbox
        class="no-grow"
        density="compact"
        hide-details
        :indeterminate="someSelected"
        :model-value="allSelected"
        :disabled="selectableKeys.length === 0"
        aria-label="Select all jobs"
        @update:model-value="toggleSelectAll"
      />
      <span class="text-caption text-medium-emphasis ml-1">
        {{ selectedKeys.length }} of {{ selectableKeys.length }} selected
      </span>
      <v-spacer />
      <v-btn
        icon
        variant="text"
        size="small"
        :disabled="selectedKeys.length === 0"
        @click="pendingDelete = selectedJobs()"
      >
        <v-icon>mdi-delete-outline</v-icon>
        <v-tooltip
          :disabled="selectedKeys.length === 0"
          location="top"
          activator="parent"
        >
          Delete selected
        </v-tooltip>
      </v-btn>
    </div>

    <!-- ----------------------------------------------------------------- -->
    <!-- Job rows                                                          -->
    <!-- ----------------------------------------------------------------- -->
    <div v-for="job in jobs" :key="rowKey(job)" class="job-row">
      <div class="job-main-row">
        <v-checkbox
          class="no-grow"
          density="compact"
          hide-details
          :value="rowKey(job)"
          v-model="selectedKeys"
          :disabled="!isTerminal(job)"
          aria-label="Select job"
        />
        <div class="job-heading">
          <div class="job-title text-body-2">
            {{ jobTitleFor(job) }}
            <v-tooltip activator="parent" location="top">
              {{ jobTooltipFor(job) }}
            </v-tooltip>
          </div>
          <div class="text-caption text-medium-emphasis job-subtitle">
            {{ jobSubtitleFor(job) }}
          </div>
        </div>
        <span class="job-trailing">
          <!-- Running: progress + best-effort cancel (one neutral store call;
               the poller converges the job to its terminal state, so these
               disappear once it settles). -->
          <template v-if="!isTerminal(job)">
            <v-progress-circular
              :indeterminate="job.progress == null"
              :model-value="(job.progress ?? 0) * 100"
              size="18"
              width="2"
            />
            <v-btn
              icon
              variant="text"
              size="small"
              :loading="cancellingJobKeys.has(rowKey(job))"
              :disabled="cancellingJobKeys.has(rowKey(job))"
              :aria-label="
                cancellingJobKeys.has(rowKey(job))
                  ? 'Canceling job'
                  : 'Cancel job'
              "
              @click="cancel(job)"
            >
              <v-icon>mdi-close</v-icon>
              <v-tooltip activator="parent" location="top">
                {{
                  cancellingJobKeys.has(rowKey(job))
                    ? 'Canceling job'
                    : 'Cancel job'
                }}
              </v-tooltip>
            </v-btn>
          </template>
          <!-- Terminal: only flag unhappy outcomes; success is unadorned. -->
          <template v-else>
            <span v-if="job.state === 'error'" class="d-inline-flex">
              <v-icon color="warning" size="18">mdi-alert-outline</v-icon>
              <v-tooltip activator="parent" location="top">
                Job failed
              </v-tooltip>
            </span>
            <span
              v-else-if="job.state === 'cancelled'"
              class="d-inline-flex text-medium-emphasis"
            >
              <v-icon size="18">mdi-cancel</v-icon>
              <v-tooltip activator="parent" location="top">
                Job cancelled
              </v-tooltip>
            </span>
            <v-btn
              icon
              variant="text"
              size="small"
              :loading="deletingJobKeys.has(rowKey(job))"
              aria-label="Delete job"
              @click="pendingDelete = [job]"
            >
              <v-icon>mdi-delete-outline</v-icon>
              <v-tooltip activator="parent" location="top">Delete</v-tooltip>
            </v-btn>
          </template>
        </span>
      </div>

      <div class="job-body">
        <!-- Explicit historical-apply actions for terminal success jobs. A job
             that finished while VolView was closed loads its results on demand;
             a live-completed job already has them. Each result applies to the
             CURRENT scene through the same intents the live flow uses. -->
        <template v-if="job.state === 'success'">
          <v-btn
            v-if="!resultsLoadedFor(job)"
            size="x-small"
            variant="text"
            class="px-0"
            prepend-icon="mdi-tray-arrow-down"
            :loading="resultsLoadingJobKeys.has(rowKey(job))"
            @click="loadResults(job)"
          >
            Show results
          </v-btn>
          <div
            v-for="result in resultsFor(job)"
            :key="result.id"
            class="result-row mb-1"
          >
            <div
              class="text-caption font-weight-medium result-name"
              :title="result.name"
            >
              {{ result.name }}
            </div>
            <div class="result-actions">
              <v-btn
                v-for="action in applyActions"
                :key="action.verb"
                size="x-small"
                variant="tonal"
                density="comfortable"
                :loading="isApplying(job, result.id)"
                :disabled="
                  isApplying(job, result.id) ||
                  (action.needsImage && !currentImageID)
                "
                @click="applyResult(job, result, action.verb)"
              >
                {{ action.label }}
                <v-tooltip
                  v-if="action.needsImage && !currentImageID"
                  activator="parent"
                  location="top"
                >
                  Load an image first
                </v-tooltip>
              </v-btn>
            </div>
          </div>
          <div
            v-if="resultsLoadedFor(job) && resultsFor(job).length === 0"
            class="text-caption text-medium-emphasis"
          >
            No results
          </div>
          <div v-if="missingFor(job) > 0" class="text-caption text-warning">
            {{ missingFor(job) }} output{{ missingFor(job) === 1 ? '' : 's' }}
            unavailable
          </div>
        </template>
        <div v-else-if="job.state === 'error'" class="job-error-summary">
          <pre class="error-log">{{ errorSummaryFor(job) }}</pre>
        </div>

        <div
          v-if="
            providers.jobHistory.has(rowKey(job)) ||
            parametersFor(job).length > 0
          "
          class="job-parameters"
        >
          <v-btn
            size="x-small"
            variant="text"
            class="px-0"
            :prepend-icon="
              expandedJobKeys.has(rowKey(job))
                ? 'mdi-chevron-down'
                : 'mdi-chevron-right'
            "
            @click="toggleParameters(job)"
          >
            Details
          </v-btn>
          <v-expand-transition>
            <dl v-if="expandedJobKeys.has(rowKey(job))" class="parameter-list">
              <div class="parameter-row" :title="`Job ID: ${job.jobId}`">
                <dt>Job ID</dt>
                <dd>{{ job.jobId }}</dd>
              </div>
              <div
                v-if="providers.jobHistoryDetails.get(rowKey(job))?.log.length"
                class="parameter-row"
              >
                <dt>Log</dt>
                <dd>
                  {{
                    providers.jobHistoryDetails.get(rowKey(job))?.log.join('')
                  }}
                </dd>
              </div>
              <div
                v-for="parameter in parametersFor(job)"
                :key="parameter.id"
                class="parameter-row"
                :title="`${parameter.label}: ${parameter.value}`"
              >
                <dt>{{ parameter.label }}</dt>
                <dd>{{ parameter.value }}</dd>
              </div>
            </dl>
          </v-expand-transition>
        </div>
      </div>
    </div>

    <v-btn
      v-if="!providers.jobHistoryComplete && !hasFilters"
      block
      size="small"
      variant="text"
      :loading="providers.jobHistoryLoading"
      @click="providers.loadMoreJobHistory()"
    >
      Load more
    </v-btn>

    <v-dialog
      :model-value="pendingDelete !== null"
      max-width="380"
      @update:model-value="
        (open) => {
          if (!open) pendingDelete = null;
        }
      "
    >
      <v-card>
        <v-card-title class="text-body-1">
          Delete
          {{ pendingDeleteCount === 1 ? 'job' : `${pendingDeleteCount} jobs` }}?
        </v-card-title>
        <v-card-text class="text-body-2">
          Deleting
          {{ pendingDeleteCount === 1 ? 'this job' : 'these jobs' }}
          also deletes
          {{ pendingDeleteCount === 1 ? 'its' : 'their' }}
          results. This cannot be undone.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="pendingDelete = null">Cancel</v-btn>
          <v-btn color="error" variant="text" @click="confirmDelete">
            Delete
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';

import { useProcessingJobsStore } from '@/src/processing/store';
import type {
  ProcessingResult,
  SubmittedJobContext,
  SubmittedJobParameterDisplay,
  TrackedJobRef,
} from '@/src/processing/types';
import { jobKey, isTerminalJobState } from '@/src/processing/types';
import {
  JOB_STATES,
  knownResultIntentSchema,
  type KnownResultIntent,
} from '@/backend-contract';
import {
  jobErrorSummary,
  selectJobHistoryRows,
  jobHistoryFiltersBlocked,
  type JobHistoryFilters,
  type JobHistoryDisplayRow,
} from '@/src/processing/engine/jobHistory';
import { applyIntent } from '@/src/processing/applyResults';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useJobResultReviewStore } from '@/src/processing/jobResultReview';
import { useMessageStore } from '@/src/store/messages';

const providers = useProcessingJobsStore();
const reviewStore = useJobResultReviewStore();
const messageStore = useMessageStore();
const { currentImageID } = useCurrentImage();

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

const filtersOpen = ref(false);
const filters = reactive<JobHistoryFilters>({});
const statusItems = [...JOB_STATES];
const timeFieldItems = [
  { title: 'Created', value: 'created' },
  { title: 'Started', value: 'started' },
  { title: 'Finished', value: 'finished' },
];
const activeFilterCount = computed(
  () =>
    [
      filters.statuses?.length,
      filters.task,
      filters.after,
      filters.before,
      filters.text,
      filters.outputHealth,
    ].filter(Boolean).length
);
const hasFilters = computed(() => activeFilterCount.value > 0);

watch(hasFilters, (active) => {
  if (active) void providers.loadAllJobHistory();
});

function clearFilters() {
  filters.statuses = undefined;
  filters.task = undefined;
  filters.timeField = undefined;
  filters.after = undefined;
  filters.before = undefined;
  filters.text = undefined;
  filters.outputHealth = undefined;
}

// Every per-job store map/set is keyed by (providerId, jobId): each rendered
// `job` row carries its providerId, so build the composite ref/key from it.
type JobRow = JobHistoryDisplayRow;
const rowRef = (job: JobRow): TrackedJobRef => ({
  providerId: job.providerId,
  jobId: job.jobId,
});
const rowKey = (job: JobRow): string => jobKey(rowRef(job));

const isTerminal = (job: JobRow): boolean => isTerminalJobState(job.state);

const jobs = computed(() => {
  if (jobHistoryFiltersBlocked(hasFilters.value, providers.jobHistoryComplete))
    return [];
  const summaries = selectJobHistoryRows(
    Array.from(providers.jobHistory.values()),
    providers.jobs,
    providers.submittedContexts,
    filters
  );
  return summaries.sort((a, b) => {
    const aSubmittedAt = providers.submittedContexts.get(
      rowKey(a)
    )?.submittedAt;
    const bSubmittedAt = providers.submittedContexts.get(
      rowKey(b)
    )?.submittedAt;
    return timestampFor(bSubmittedAt) - timestampFor(aSubmittedAt);
  });
});

// ---------------------------------------------------------------------------
// Selection (batch delete) — only terminal jobs are selectable, matching the
// backend's 409 on a nonterminal delete.
// ---------------------------------------------------------------------------

const selectedKeys = ref<string[]>([]);

const selectableKeys = computed(() =>
  jobs.value.filter(isTerminal).map(rowKey)
);

// Prune selections whose rows disappeared (deleted, filtered out) or went
// nonterminal (a re-listed provider job that is somehow live again).
watch(selectableKeys, (keys) => {
  const valid = new Set(keys);
  const pruned = selectedKeys.value.filter((key) => valid.has(key));
  if (pruned.length !== selectedKeys.value.length) selectedKeys.value = pruned;
});

const allSelected = computed(
  () =>
    selectableKeys.value.length > 0 &&
    selectedKeys.value.length === selectableKeys.value.length
);
const someSelected = computed(
  () => selectedKeys.value.length > 0 && !allSelected.value
);

function toggleSelectAll(shouldSelectAll: boolean | null) {
  selectedKeys.value = shouldSelectAll ? [...selectableKeys.value] : [];
}

function selectedJobs(): JobRow[] {
  const chosen = new Set(selectedKeys.value);
  return jobs.value.filter((job) => chosen.has(rowKey(job)));
}

// All per-job UI state below is keyed by the composite rowKey(job), never a raw
// jobId — two providers may share a jobId.
const expandedJobKeys = reactive(new Set<string>());
// Jobs with an in-flight cancel request (drives the Cancel button spinner).
const cancellingJobKeys = reactive(new Set<string>());
const deletingJobKeys = reactive(new Set<string>());

// Best-effort cancel: fire the one neutral store call and let the poller
// converge the job to its terminal state (the store never fabricates
// `cancelled`). Errors are surfaced by the store; we only own the button state.
async function cancel(job: JobRow) {
  const key = rowKey(job);
  cancellingJobKeys.add(key);
  try {
    await providers.cancelJob(rowRef(job));
  } finally {
    cancellingJobKeys.delete(key);
  }
}

// Deleting a job also deletes its server-side output folder (its results), so
// both the per-row trash button and the batch header button stage rows here
// and open one confirmation dialog.
const pendingDelete = ref<JobRow[] | null>(null);
const pendingDeleteCount = computed(() => pendingDelete.value?.length ?? 0);

async function confirmDelete() {
  const toDelete = pendingDelete.value ?? [];
  pendingDelete.value = null;
  await Promise.all(toDelete.map((job) => remove(job)));
}

async function remove(job: JobRow) {
  const key = rowKey(job);
  deletingJobKeys.add(key);
  try {
    await providers.deleteJob(rowRef(job));
  } finally {
    deletingJobKeys.delete(key);
  }
}

function resultsFor(job: JobRow): ProcessingResult[] {
  return providers.jobResults.get(rowKey(job)) ?? [];
}

function missingFor(job: JobRow): number {
  const key = rowKey(job);
  return (
    providers.jobResultMissing.get(key) ??
    providers.jobHistory.get(key)?.outputSummary?.missing ??
    0
  );
}

// A job that finished while VolView was closed has no results in the store until
// they are fetched on demand (a live-completed job already has them). `.has`
// distinguishes "not yet fetched" from "fetched, no outputs".
function resultsLoadedFor(job: JobRow): boolean {
  return providers.jobResults.has(rowKey(job));
}

// Jobs whose results are being fetched (drives the "Show results" spinner).
const resultsLoadingJobKeys = reactive(new Set<string>());
// Result rows with an in-flight apply, keyed `${rowKey(job)}:${resultId}`.
const applyingResultKeys = reactive(new Set<string>());

const applyKey = (job: JobRow, resultId: string) =>
  `${rowKey(job)}:${resultId}`;
const isApplying = (job: JobRow, resultId: string) =>
  applyingResultKeys.has(applyKey(job, resultId));

async function loadResults(job: JobRow) {
  const key = rowKey(job);
  resultsLoadingJobKeys.add(key);
  try {
    await providers.loadJobResults(rowRef(job));
  } finally {
    resultsLoadingJobKeys.delete(key);
  }
}

// The three explicit historical-apply verbs surfaced per result — the same
// intents the live auto-apply flow emits.
type ApplyVerb = Extract<
  KnownResultIntent['intent'],
  'add-base-image' | 'add-layer' | 'add-segment-group'
>;

// The apply buttons rendered per result. `needsImage` gates on a loaded current
// image (with the "Load an image first" tooltip); Open needs none.
const applyActions: { verb: ApplyVerb; label: string; needsImage: boolean }[] =
  [
    { verb: 'add-base-image', label: 'Open', needsImage: false },
    { verb: 'add-layer', label: 'Add as layer', needsImage: true },
    {
      verb: 'add-segment-group',
      label: 'Add as segment group',
      needsImage: true,
    },
  ];

// Apply a historical result to the CURRENT scene through the SAME `applyIntent`
// path the live flow uses (no second application path, no artifact composition). The user
// picks the verb; the parent is whatever image is active now, not the job's
// original submit context.
async function applyResult(
  job: JobRow,
  result: ProcessingResult,
  verb: ApplyVerb
) {
  const candidate = {
    intent: verb,
    id: result.id,
    url: result.url,
    name: result.name,
    ...(result.segments ? { segments: result.segments } : {}),
    ...(result.source ? { source: result.source } : {}),
  };
  const parsed = knownResultIntentSchema.safeParse(candidate);
  if (!parsed.success) {
    messageStore.addWarning(`Could not apply ${result.name}`, {
      details: 'The result intent is unknown or malformed.',
    });
    return;
  }
  const base = contextFor(job);
  const context: SubmittedJobContext = {
    jobId: job.jobId,
    taskId: base?.taskId ?? '',
    providerId: base?.providerId ?? job.providerId,
    submittedAt: base?.submittedAt ?? '',
    ...base,
    activeDatasetId: currentImageID.value ?? undefined,
  };
  const key = applyKey(job, result.id);
  applyingResultKeys.add(key);
  try {
    const outcome = await applyIntent(parsed.data, context);
    if (outcome.status === 'applied') {
      // Badge any freshly-attached segment group new, mirroring auto-apply.
      outcome.bindings.segmentGroupIds.forEach((id) => reviewStore.markNew(id));
      messageStore.addSuccess(`Applied ${result.name}`);
    } else if (outcome.status === 'failed') {
      messageStore.addError(`Failed to apply ${result.name}`, {
        error: outcome.error instanceof Error ? outcome.error : undefined,
      });
    } else {
      messageStore.addWarning(`Could not apply ${result.name}`, {
        details: outcome.reason,
      });
    }
  } finally {
    applyingResultKeys.delete(key);
  }
}

function contextFor(job: JobRow): SubmittedJobContext | undefined {
  return providers.submittedContexts.get(rowKey(job));
}

function taskTitleFor(job: JobRow): string {
  const context = contextFor(job);
  return context?.display?.taskTitle ?? job.taskTitle ?? job.jobId;
}

function parametersFor(job: JobRow): SubmittedJobParameterDisplay[] {
  const detail = providers.jobHistoryDetails.get(rowKey(job));
  if (detail) {
    return Object.entries(detail.parameters).map(([id, value]) => ({
      id,
      label: id,
      value:
        typeof value === 'string'
          ? value
          : (JSON.stringify(value) ?? String(value)),
    }));
  }
  return contextFor(job)?.display?.parameters ?? [];
}

// Task + input dataset only; parameters live behind Details.
function jobTitleFor(job: JobRow): string {
  const pieces = [taskTitleFor(job), contextFor(job)?.display?.inputName];
  return pieces.filter((piece): piece is string => !!piece).join(' — ');
}

function timestampFor(instant: string | undefined): number {
  if (!instant) return 0;
  const timestamp = Date.parse(instant);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatInstant(instant: string | undefined): string | undefined {
  const timestamp = timestampFor(instant);
  if (!timestamp) return undefined;
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const STATE_LABELS: Partial<Record<string, string>> = {
  error: 'Failed',
  cancelled: 'Cancelled',
  pending: 'Pending',
  running: 'Running',
};

function jobSubtitleFor(job: JobRow): string {
  const pieces = [
    STATE_LABELS[job.state],
    formatInstant(contextFor(job)?.submittedAt ?? job.createdAt),
  ];
  return pieces.filter(Boolean).join(' · ');
}

function statusTooltipFor(job: JobRow): string {
  if (cancellingJobKeys.has(rowKey(job))) return 'canceling';
  const pct =
    job.progress != null ? ` (${Math.round(job.progress * 100)}%)` : '';
  return `${job.state}${pct}`;
}

function jobTooltipFor(job: JobRow): string {
  return `${jobTitleFor(job)} - ${statusTooltipFor(job)}`;
}

function toggleParameters(job: JobRow) {
  const key = rowKey(job);
  if (expandedJobKeys.has(key)) {
    expandedJobKeys.delete(key);
    return;
  }
  expandedJobKeys.add(key);
  void providers.loadJobHistoryDetail(rowRef(job));
}

function errorSummaryFor(job: JobRow): string {
  const detailLog = providers.jobHistoryDetails.get(rowKey(job))?.log.join('');
  return jobErrorSummary(job, detailLog);
}
</script>

<style scoped>
.no-grow {
  flex: 0 0 auto;
}
.selection-header {
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}
.job-row {
  padding: 6px 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.job-main-row {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  column-gap: 4px;
}
.job-heading {
  min-width: 0;
  flex: 1 1 auto;
  user-select: text;
}
.job-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.job-subtitle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.job-trailing {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  column-gap: 2px;
  margin-left: auto;
}
.job-body {
  margin-left: 40px;
  user-select: text;
}
.job-filters {
  display: grid;
  gap: 8px;
}
.job-parameters {
  margin-top: 2px;
}
.parameter-list {
  margin: 2px 0 0 8px;
  font-size: 0.8rem;
}
.parameter-row {
  display: grid;
  grid-template-columns: minmax(72px, 40%) minmax(0, 1fr);
  column-gap: 8px;
  min-width: 0;
}
.parameter-row dt {
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.parameter-row dt,
.parameter-row dd {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.parameter-row dd {
  min-width: 0;
  margin: 0;
}
.error-log {
  white-space: pre-wrap;
  font-size: 0.75rem;
  margin: 4px 0 0;
}
.job-error-summary {
  color: rgb(var(--v-theme-error));
}
.result-row {
  padding: 2px 0;
}
.result-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
}
.result-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
