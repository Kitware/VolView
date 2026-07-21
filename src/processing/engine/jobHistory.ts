import type { JobState, JobHistorySummary } from '@/backend-contract';
import type {
  ProcessingJobStatus,
  SubmittedJobContext,
} from '@/src/processing/types';
import { jobKey } from '@/src/processing/types';

// Rows key on (providerId, jobId) because two providers may share a raw jobId.
export type TrackedJobHistorySummary = JobHistorySummary & {
  providerId: string;
};

export type JobHistoryFilters = {
  statuses?: JobState[];
  task?: string;
};

export type JobHistoryDisplayRow = TrackedJobHistorySummary & {
  errorTail?: string;
};

export const filterJobHistory = <T extends JobHistorySummary>(
  jobs: T[],
  filters: JobHistoryFilters
): T[] => {
  const task = filters.task?.trim().toLocaleLowerCase();
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
    return true;
  });
};

// A live status carries no providerId; the context at the same key supplies it.
export const selectJobHistoryRows = (
  durable: TrackedJobHistorySummary[],
  live: ReadonlyMap<string, ProcessingJobStatus>,
  contexts: ReadonlyMap<string, SubmittedJobContext>
): JobHistoryDisplayRow[] => {
  const byKey = new Map<string, JobHistoryDisplayRow>(
    durable.map((job) => [
      jobKey({ providerId: job.providerId, jobId: job.jobId }),
      job,
    ])
  );
  live.forEach((status, key) => {
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
  return Array.from(byKey.values());
};
