import type { JobState, JobHistorySummary } from '@/backend-contract';
import type {
  ProcessingJobStatus,
  SubmittedJobContext,
} from '@/src/processing/types';
import { jobKey, missingJobErrorDetails } from '@/src/processing/types';

export type JobHistoryOutputHealth = 'missing';

// A durable history summary carrying the provider that produced it, so a row can
// be keyed by (providerId, jobId) — two folder-scoped providers may share a raw
// jobId.
export type TrackedJobHistorySummary = JobHistorySummary & {
  providerId: string;
};

export type JobHistoryFilters = {
  statuses?: JobState[];
  task?: string;
  timeField?: 'created' | 'started' | 'finished';
  after?: string;
  before?: string;
  text?: string;
  outputHealth?: JobHistoryOutputHealth;
};

export type JobHistoryDisplayRow = JobHistorySummary & {
  providerId: string;
  errorTail?: string;
};

export const jobHistoryFiltersBlocked = (
  hasFilters: boolean,
  historyComplete: boolean
) => hasFilters && !historyComplete;

const instant = (value: string | undefined) => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? undefined : parsed;
};

// The only output-health predicate: outputs the backend recorded but could not
// resolve (deleted / unreadable files).
const hasMissingOutputs = (job: JobHistorySummary) =>
  (job.outputSummary?.missing ?? 0) > 0;

export const filterJobHistory = <T extends JobHistorySummary>(
  jobs: T[],
  filters: JobHistoryFilters
): T[] => {
  const task = filters.task?.trim().toLocaleLowerCase();
  const text = filters.text?.trim().toLocaleLowerCase();
  const after = instant(filters.after);
  const before = instant(filters.before);
  return jobs.filter((job) => {
    if (filters.statuses?.length && !filters.statuses.includes(job.state)) {
      return false;
    }
    if (
      task &&
      !job.taskId.toLocaleLowerCase().includes(task) &&
      !job.taskTitle.toLocaleLowerCase().includes(task)
    ) {
      return false;
    }
    const timeValue =
      filters.timeField === 'started'
        ? job.startedAt
        : filters.timeField === 'finished'
          ? job.finishedAt
          : job.createdAt;
    const time = instant(timeValue);
    if (after != null && (time == null || time < after)) return false;
    if (before != null && (time == null || time > before)) return false;
    if (
      text &&
      !job.jobId.toLocaleLowerCase().includes(text) &&
      !job.taskTitle.toLocaleLowerCase().includes(text)
    ) {
      return false;
    }
    if (filters.outputHealth === 'missing' && !hasMissingOutputs(job)) {
      return false;
    }
    return true;
  });
};

// Merge durable history rows with live in-session statuses into display rows,
// each keyed by (providerId, jobId). `live` and `contexts` are the store's own
// jobKey-keyed maps, so two providers' identically-numbered jobs never collide.
// A live status carries no providerId of its own; it recovers one from the
// SubmittedJobContext at the SAME composite key.
export const selectJobHistoryRows = (
  durable: TrackedJobHistorySummary[],
  live: ReadonlyMap<string, ProcessingJobStatus>,
  contexts: ReadonlyMap<string, SubmittedJobContext>,
  filters: JobHistoryFilters
): JobHistoryDisplayRow[] => {
  const byKey = new Map<string, JobHistoryDisplayRow>(
    durable.map((job) => [
      jobKey({ providerId: job.providerId, jobId: job.jobId }),
      job,
    ])
  );
  live.forEach((status, key) => {
    // The live overlay written onto both an existing durable row and a
    // context-recovered new row.
    const liveFields = {
      state: status.state,
      resultState: status.resultState,
      ...(status.progress != null ? { progress: status.progress } : {}),
      ...(status.errorTail ? { errorTail: status.errorTail } : {}),
    };
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, { ...existing, ...liveFields });
      return;
    }
    const context = contexts.get(key);
    if (!context) return;
    byKey.set(key, {
      providerId: context.providerId,
      jobId: status.jobId,
      taskId: context.taskId,
      taskTitle: context.display?.taskTitle ?? context.taskId,
      createdBy: { id: '', name: '' },
      createdAt: context.submittedAt,
      ...liveFields,
    });
  });
  return filterJobHistory(Array.from(byKey.values()), filters);
};

export const jobErrorSummary = (
  job: Pick<JobHistoryDisplayRow, 'jobId' | 'errorTail'>,
  detailLog?: string
): string => {
  const normalized =
    detailLog?.trim().replace(/\s+/g, ' ') ||
    job.errorTail?.trim().replace(/\s+/g, ' ') ||
    missingJobErrorDetails(job.jobId);
  return normalized.length > 240
    ? `${normalized.slice(0, 237).trimEnd()}...`
    : normalized;
};
