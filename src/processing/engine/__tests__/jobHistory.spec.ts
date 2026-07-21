import { describe, expect, it } from 'vitest';

import {
  filterJobHistory,
  jobErrorSummary,
  selectJobHistoryRows,
  type JobHistoryFilters,
} from '@/src/processing/engine/jobHistory';
import type { JobHistorySummary } from '@/backend-contract';
import { jobKey } from '@/src/processing/types';
import type {
  ProcessingJobStatus,
  SubmittedJobContext,
} from '@/src/processing/types';

const summary = (
  overrides: Partial<JobHistorySummary> = {}
): JobHistorySummary => ({
  jobId: 'job-1',
  taskId: 'threshold',
  taskTitle: 'Threshold segmentation',
  createdBy: { id: 'user-1', name: 'Ada Lovelace' },
  createdAt: '2026-06-01T12:00:00Z',
  state: 'success',
  resultState: 'ready',
  outputSummary: { recorded: 2, missing: 0 },
  ...overrides,
});

const filter = (
  jobs: JobHistorySummary[],
  overrides: Partial<JobHistoryFilters>
) => filterJobHistory(jobs, overrides);

describe('job history filters', () => {
  const jobs = [
    summary(),
    summary({
      jobId: 'job-2',
      taskId: 'registration',
      taskTitle: 'Rigid registration',
      createdAt: '2026-05-01T12:00:00Z',
      state: 'error',
      resultState: 'unavailable',
      outputSummary: { recorded: 1, missing: 1 },
    }),
  ];

  it('filters by status and task', () => {
    expect(filter(jobs, { statuses: ['error'] }).map((j) => j.jobId)).toEqual([
      'job-2',
    ]);
    expect(filter(jobs, { task: 'threshold' }).map((j) => j.jobId)).toEqual([
      'job-1',
    ]);
  });

  it('filters by created/started/finished time and job-id/title text', () => {
    expect(
      filter(jobs, { timeField: 'created', after: '2026-05-15T00:00:00Z' })
    ).toHaveLength(1);
    expect(
      filter([summary({ startedAt: '2026-06-02T00:00:00Z' }), jobs[1]], {
        timeField: 'started',
        after: '2026-06-01T00:00:00Z',
      })
    ).toHaveLength(1);
    expect(
      filter([summary({ finishedAt: '2026-06-03T00:00:00Z' }), jobs[1]], {
        timeField: 'finished',
        before: '2026-06-04T00:00:00Z',
      })
    ).toHaveLength(1);
    expect(filter(jobs, { text: 'JOB-2' }).map((j) => j.jobId)).toEqual([
      'job-2',
    ]);
    expect(filter(jobs, { text: 'rigid' }).map((j) => j.jobId)).toEqual([
      'job-2',
    ]);
  });

  it('filters by output health (only missing outputs)', () => {
    expect(
      filter(jobs, { outputHealth: 'missing' }).map((j) => j.jobId)
    ).toEqual(['job-2']);
    // A job with no missing outputs is excluded by the missing-outputs filter.
    const healthy = summary({
      jobId: 'healthy',
      outputSummary: { recorded: 2, missing: 0 },
    });
    expect(filter([healthy], { outputHealth: 'missing' })).toEqual([]);
  });

  it('includes a matching current-session job after durable history completed', () => {
    // `live` and `contexts` are the store's jobKey-keyed maps; a live status
    // recovers its providerId from the context at the SAME composite key.
    const key = jobKey({ providerId: 'p1', jobId: 'live-job' });
    const rows = selectJobHistoryRows(
      [{ ...summary(), providerId: 'p1' }],
      new Map<string, ProcessingJobStatus>([
        [key, { jobId: 'live-job', state: 'running', resultState: 'waiting' }],
      ]),
      new Map<string, SubmittedJobContext>([
        [
          key,
          {
            jobId: 'live-job',
            taskId: 'live-threshold',
            providerId: 'p1',
            submittedAt: '2026-07-12T12:00:00Z',
            display: { taskTitle: 'Live threshold', parameters: [] },
          },
        ],
      ]),
      { statuses: ['running'], text: 'LIVE-JOB', task: 'threshold' }
    );
    expect(rows.map((row) => row.jobId)).toEqual(['live-job']);
    expect(rows[0].providerId).toBe('p1');
  });

  it('retains and renders a current-session error tail after union filtering', () => {
    const key = jobKey({ providerId: 'p1', jobId: 'live-error' });
    const rows = selectJobHistoryRows(
      [{ ...summary(), providerId: 'p1' }],
      new Map<string, ProcessingJobStatus>([
        [
          key,
          {
            jobId: 'live-error',
            state: 'error',
            resultState: 'unavailable',
            errorTail: 'Concrete worker failure: invalid mask',
          },
        ],
      ]),
      new Map<string, SubmittedJobContext>([
        [
          key,
          {
            jobId: 'live-error',
            taskId: 'live-threshold',
            providerId: 'p1',
            submittedAt: '2026-07-12T12:00:00Z',
            display: { taskTitle: 'Live threshold', parameters: [] },
          },
        ],
      ]),
      { statuses: ['error'], text: 'live-error' }
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].providerId).toBe('p1');
    expect(rows[0].errorTail).toBe('Concrete worker failure: invalid mask');
    expect(jobErrorSummary(rows[0])).toBe(
      'Concrete worker failure: invalid mask'
    );
  });

  it('clear is client-only and restores all fully loaded summaries', () => {
    expect(filterJobHistory(jobs, {})).toEqual(jobs);
  });
});
