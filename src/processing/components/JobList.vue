<template>
  <div>
    <div class="filter-toggle-row">
      <v-btn
        size="small"
        variant="text"
        class="px-1 text-medium-emphasis"
        prepend-icon="mdi-filter-variant"
        :append-icon="filtersOpen ? 'mdi-chevron-up' : 'mdi-chevron-down'"
        @click="filtersOpen = !filtersOpen"
      >
        Filter{{ activeFilterCount > 0 ? ` (${activeFilterCount})` : '' }}
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
      <div v-show="filtersOpen">
        <div class="filter-card mb-2">
          <div class="filter-field-label">Job type</div>
          <v-select
            v-model="jobTypeFilter"
            :items="jobTypeItems"
            variant="outlined"
            density="compact"
            hide-details
            class="mb-2"
          />

          <div class="filter-field-label">Status</div>
          <v-select
            v-model="statusFilter"
            :items="statusFilterItems"
            variant="outlined"
            density="compact"
            hide-details
          />
        </div>
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
        @click="providers.loadAllJobHistory()"
      >
        Retry
      </v-btn>
    </div>

    <div v-for="job in jobs" :key="rowKey(job)" class="job-row">
      <div class="job-main-row">
        <span class="job-status-indicator">
          <v-progress-circular
            v-if="!isTerminal(job)"
            indeterminate
            size="16"
            width="2"
            color="primary"
          />
          <span v-else-if="job.state === 'success'" class="status-dot" />
          <v-icon v-else-if="job.state === 'error'" color="warning" size="18">
            mdi-alert-circle
          </v-icon>
          <v-icon v-else class="text-medium-emphasis" size="18">
            mdi-cancel
          </v-icon>
        </span>
        <div class="job-heading">
          <div class="job-title text-body-2">
            {{ jobTitleFor(job) }}
            <v-tooltip activator="parent" location="top">
              {{ jobTooltipFor(job) }}
            </v-tooltip>
          </div>
          <div
            class="text-caption job-subtitle"
            :class="
              job.state === 'error' ? 'text-warning' : 'text-medium-emphasis'
            "
          >
            {{ jobSubtitleFor(job) }}
          </div>
        </div>
        <span class="job-trailing">
          <v-btn
            v-if="!isTerminal(job)"
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
          <v-btn
            v-else
            icon
            variant="text"
            size="small"
            :loading="deletingJobKeys.has(rowKey(job))"
            aria-label="Delete job"
            @click="pendingDelete = job"
          >
            <v-icon>mdi-delete</v-icon>
            <v-tooltip activator="parent" location="top">Delete</v-tooltip>
          </v-btn>
        </span>
      </div>

      <div class="job-body">
        <div
          v-if="job.state === 'success' && !resultsLoadedFor(job)"
          class="load-row"
        >
          <span class="text-caption text-medium-emphasis load-explainer">
            Finished while VolView was closed, not in the scene yet.
          </span>
          <v-btn
            size="small"
            variant="tonal"
            prepend-icon="mdi-tray-arrow-down"
            :loading="resultsLoadingJobKeys.has(rowKey(job))"
            @click="loadResults(job)"
          >
            Load
          </v-btn>
        </div>
        <div v-if="missingFor(job) > 0" class="text-caption text-warning">
          {{ missingFor(job) }} {{ plural(missingFor(job), 'output') }}
          unavailable
        </div>
        <div class="job-details">
          <v-btn
            size="x-small"
            variant="text"
            class="px-0 details-btn"
            :prepend-icon="
              expandedJobKeys.has(rowKey(job))
                ? 'mdi-chevron-down'
                : 'mdi-chevron-right'
            "
            @click="toggleDetails(job)"
          >
            Details
          </v-btn>
          <v-expand-transition>
            <div v-if="expandedJobKeys.has(rowKey(job))">
              <div class="job-id-row">
                <span class="text-caption text-medium-emphasis">Job ID</span>
                <code class="job-id" :title="job.jobId">{{ job.jobId }}</code>
                <v-btn
                  icon
                  variant="text"
                  size="x-small"
                  aria-label="Copy job ID"
                  @click="copyJobId(job)"
                >
                  <v-icon size="14">mdi-content-copy</v-icon>
                  <v-tooltip activator="parent" location="top">
                    {{
                      copied && copiedJobKey === rowKey(job) ? 'Copied' : 'Copy'
                    }}
                  </v-tooltip>
                </v-btn>
              </div>
              <pre v-if="job.state === 'error'" class="error-log">{{
                errorLogFor(job)
              }}</pre>
            </div>
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
        <v-card-title class="text-body-1">Delete job?</v-card-title>
        <v-card-text class="text-body-2">
          Deleting this job also deletes its results. This cannot be undone.
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
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useClipboard } from '@vueuse/core';
import { plural } from '@/src/utils';

import { useProcessingJobsStore } from '@/src/processing/store';
import type {
  JobState,
  ProcessingResult,
  SubmittedJobContext,
  TrackedJobRef,
} from '@/src/processing/types';
import {
  jobKey,
  isTerminalJobState,
  missingJobErrorDetails,
} from '@/src/processing/types';
import {
  filterJobHistory,
  type JobHistoryDisplayRow,
} from '@/src/processing/engine/jobHistory';
import { autoLoadProcessingResults } from '@/src/processing/applyResults';

const providers = useProcessingJobsStore();

const filtersOpen = ref(false);

const jobTypeItems = computed(() => [
  { title: 'All tasks', value: null },
  ...Array.from(new Set(providers.jobHistoryRows.map((job) => job.taskTitle)))
    .sort()
    .map((title) => ({ title, value: title })),
]);
const jobTypeFilter = ref<string | null>(null);

const STATUS_FILTERS: Record<string, JobState[]> = {
  success: ['success'],
  error: ['error'],
  active: ['pending', 'running'],
};
const statusFilterItems = [
  { title: 'All statuses', value: null },
  { title: 'Succeeded', value: 'success' },
  { title: 'Failed', value: 'error' },
  { title: 'In progress', value: 'active' },
];
const statusFilter = ref<string | null>(null);

const filters = computed(() => ({
  task: jobTypeFilter.value ?? undefined,
  statuses: statusFilter.value ? STATUS_FILTERS[statusFilter.value] : undefined,
}));

const activeFilterCount = computed(
  () => [jobTypeFilter.value, statusFilter.value].filter(Boolean).length
);
const hasFilters = computed(() => activeFilterCount.value > 0);

// Also keyed on jobHistoryComplete: a provider registered after adoption
// resets it to false having fetched only one page, and with filters active the
// Load-more button is hidden — without re-firing here the filtered list would
// stay empty behind the "loading complete history" caption forever.
watch(
  [hasFilters, () => providers.jobHistoryComplete],
  ([active, complete]) => {
    if (active && !complete) void providers.loadAllJobHistory();
  }
);

function clearFilters() {
  jobTypeFilter.value = null;
  statusFilter.value = null;
}

// Two providers may share a jobId, so rows are keyed by (providerId, jobId).
type JobRow = JobHistoryDisplayRow;
const rowRef = (job: JobRow): TrackedJobRef => ({
  providerId: job.providerId,
  jobId: job.jobId,
});
const rowKey = (job: JobRow): string => jobKey(rowRef(job));

const isTerminal = (job: JobRow): boolean => isTerminalJobState(job.state);

// Filtering an incomplete history would present partial matches as the full
// answer, so filters wait for the load-all triggered above.
const jobs = computed(() => {
  if (hasFilters.value && !providers.jobHistoryComplete) return [];
  // Decorate-sort-undecorate: one timestamp parse per row, not per comparison.
  return filterJobHistory(providers.jobHistoryRows, filters.value)
    .map((job) => [sortInstantFor(job), job] as const)
    .sort(([a], [b]) => b - a)
    .map(([, job]) => job);
});

function sortInstantFor(job: JobRow): number {
  return timestampFor(
    providers.submittedContexts.get(rowKey(job))?.submittedAt ?? job.createdAt
  );
}

const expandedJobKeys = reactive(new Set<string>());
const cancellingJobKeys = reactive(new Set<string>());
const deletingJobKeys = reactive(new Set<string>());

// Cancellation is not instant server-side, so the row stays in canceling until
// the poller converges it.
async function cancel(job: JobRow) {
  const key = rowKey(job);
  if (cancellingJobKeys.has(key)) return;
  cancellingJobKeys.add(key);
  const accepted = await providers.cancelJob(rowRef(job));
  if (!accepted) cancellingJobKeys.delete(key);
}

watch(
  () => providers.jobHistoryRows,
  (rows) => {
    const nonterminal = new Set(
      rows.filter((row) => !isTerminal(row)).map(rowKey)
    );
    Array.from(cancellingJobKeys).forEach((key) => {
      if (!nonterminal.has(key)) cancellingJobKeys.delete(key);
    });
  }
);

const pendingDelete = ref<JobRow | null>(null);

async function confirmDelete() {
  const job = pendingDelete.value;
  pendingDelete.value = null;
  if (!job) return;
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

// `.has` distinguishes "not yet fetched" from "fetched, no outputs".
function resultsLoadedFor(job: JobRow): boolean {
  return providers.jobResults.has(rowKey(job));
}

const resultsLoadingJobKeys = reactive(new Set<string>());

// A labelmap whose parent image is gone from the scene falls back to opening as
// a plain dataset.
async function loadResults(job: JobRow) {
  const key = rowKey(job);
  if (resultsLoadingJobKeys.has(key)) return;
  resultsLoadingJobKeys.add(key);
  try {
    await providers.loadJobResults(rowRef(job));
    const results = providers.jobResults.get(key);
    if (!results?.length) return;
    await autoLoadProcessingResults(
      results,
      providers.contextForAutoLoad(contextFor(job))
    );
  } finally {
    resultsLoadingJobKeys.delete(key);
  }
}

function contextFor(job: JobRow): SubmittedJobContext | undefined {
  return providers.submittedContexts.get(rowKey(job));
}

function taskTitleFor(job: JobRow): string {
  const context = contextFor(job);
  return context?.display?.taskTitle ?? job.taskTitle ?? job.jobId;
}

function keyParameterFor(job: JobRow): string | undefined {
  const parameter = contextFor(job)?.display?.parameters?.find(
    (p) => p.summary
  );
  return parameter ? `${parameter.label} ${parameter.value}` : undefined;
}

function jobTitleFor(job: JobRow): string {
  return [taskTitleFor(job), keyParameterFor(job)]
    .filter((piece): piece is string => !!piece)
    .join(' · ');
}

function timestampFor(instant: string | undefined): number {
  if (!instant) return 0;
  const timestamp = Date.parse(instant);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatInstant(instant: string | undefined): string | undefined {
  const timestamp = timestampFor(instant);
  if (!timestamp) return undefined;
  const date = new Date(timestamp);
  const sameDay = date.toDateString() === new Date().toDateString();
  return date.toLocaleString(undefined, {
    ...(sameDay ? {} : { month: 'short', day: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  });
}

// A 30s tick keeps relative times honest without re-rendering every second.
const now = ref(Date.now());
const nowTicker = window.setInterval(() => {
  now.value = Date.now();
}, 30_000);
onBeforeUnmount(() => window.clearInterval(nowTicker));

function relativeInstant(instant: string | undefined): string | undefined {
  const timestamp = timestampFor(instant);
  if (!timestamp) return undefined;
  const minutes = Math.floor((now.value - timestamp) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : formatInstant(instant);
}

const STATE_LABELS: Partial<Record<string, string>> = {
  error: 'Failed',
  cancelled: 'Cancelled',
  pending: 'Pending',
  running: 'Running',
  success: 'Succeeded',
};

function finishedInstantFor(job: JobRow): string | undefined {
  return job.finishedAt ?? contextFor(job)?.submittedAt ?? job.createdAt;
}

function jobSubtitleFor(job: JobRow): string {
  const label = STATE_LABELS[job.state] ?? job.state;
  if (!isTerminal(job)) {
    // No percent — progress fractions are not reliably reported.
    return [
      cancellingJobKeys.has(rowKey(job)) ? 'Canceling…' : label,
      relativeInstant(contextFor(job)?.submittedAt ?? job.createdAt),
    ]
      .filter(Boolean)
      .join(' · ');
  }
  const resultCount =
    job.state === 'success' && resultsLoadedFor(job) && resultsFor(job).length
      ? `${resultsFor(job).length} ${plural(resultsFor(job).length, 'result')}`
      : undefined;
  return [label, resultCount, formatInstant(finishedInstantFor(job))]
    .filter(Boolean)
    .join(' · ');
}

function jobTooltipFor(job: JobRow): string {
  const status = cancellingJobKeys.has(rowKey(job)) ? 'canceling' : job.state;
  return `${jobTitleFor(job)} - ${status}`;
}

function toggleDetails(job: JobRow) {
  const key = rowKey(job);
  if (expandedJobKeys.has(key)) {
    expandedJobKeys.delete(key);
    return;
  }
  expandedJobKeys.add(key);
  void providers.loadJobHistoryDetail(rowRef(job));
}

// `copied` auto-resets, so the tooltip reverts to "Copy" on its own; the key
// scopes the flag to the row that was copied.
const { copy: copyToClipboard, copied } = useClipboard();
const copiedJobKey = ref<string | null>(null);
async function copyJobId(job: JobRow) {
  await copyToClipboard(job.jobId);
  copiedJobKey.value = rowKey(job);
}

function errorLogFor(job: JobRow): string {
  // Lines may or may not carry their own trailing newline (the wire contract
  // does not require one) — normalize so neither doubles nor runs together.
  const detailLog = providers.jobHistoryDetails
    .get(rowKey(job))
    ?.log.map((line) => line.replace(/\n$/, ''))
    .join('\n');
  return (
    detailLog?.trim() ||
    job.errorTail?.trim() ||
    missingJobErrorDetails(job.jobId)
  );
}
</script>

<style scoped>
.filter-toggle-row {
  display: flex;
  align-items: center;
  /* Pull up against the expansion-panel padding so the row hugs the header. */
  margin: -8px 0 2px;
}
.filter-card {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  border-radius: 8px;
  padding: 8px 10px;
}
.filter-field-label {
  font-size: 0.72rem;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.7);
  margin-bottom: 4px;
}
.job-row {
  padding: 6px 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.job-main-row {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  column-gap: 8px;
}
.job-status-indicator {
  flex: 0 0 auto;
  width: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.status-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #4caf50;
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
  margin-left: auto;
}
.job-body {
  margin-left: 26px;
  user-select: text;
}
.load-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0;
}
.load-explainer {
  min-width: 0;
  flex: 1 1 auto;
}
.details-btn {
  font-size: 0.65rem;
  letter-spacing: 1px;
}
.job-id-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 2px 0 4px;
}
.job-id {
  font-family: monospace;
  font-size: 0.72rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: all;
}
.error-log {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 0.75rem;
  color: rgb(var(--v-theme-error));
  margin: 4px 0 6px;
  max-height: 240px;
  overflow-y: auto;
}
</style>
