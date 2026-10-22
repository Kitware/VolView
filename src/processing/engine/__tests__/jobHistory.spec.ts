import { describe, expect, it } from 'vitest';

import {
  filterJobHistory,
  selectJobHistoryRows,
  selectParentImageUris,
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

describe('job history reference image', () => {
  const parameters = {
    absentLayer: null,
    inputPETVolume: { type: 'image', uris: ['/pet/1.dcm', '/pet/2.dcm'] },
    inputTools: { type: 'annotations', uris: ['/tools.json'] },
    inputVolume: { type: 'image', uris: ['/ct/2.dcm', '/ct/1.dcm'] },
  };

  it('selects the recorded reference with all DICOM slices regardless of key order', () => {
    expect(selectParentImageUris(parameters, 'inputVolume')).toEqual([
      '/ct/2.dcm',
      '/ct/1.dcm',
    ]);
  });

  it.each(['missing', 'absentLayer', 'inputTools'])(
    'does not fall back to another image when reference %s is unavailable',
    (reference) => {
      expect(selectParentImageUris(parameters, reference)).toBeUndefined();
    }
  );

  it('does not guess a reference for old jobs with multiple images', () => {
    expect(selectParentImageUris(parameters)).toBeUndefined();
  });

  it('recovers an old job with exactly one image input', () => {
    expect(
      selectParentImageUris({
        ...parameters,
        inputPETVolume: null,
      })
    ).toEqual(['/ct/2.dcm', '/ct/1.dcm']);
  });

  it('does not select a staged resource when no image input was supplied', () => {
    expect(
      selectParentImageUris({
        inputVolume: null,
        inputLabelmap: { type: 'labelmap', uris: ['/mask.seg.nrrd'] },
        inputTools: { type: 'annotations', uris: ['/tools.json'] },
      })
    ).toBeUndefined();
  });
});

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

  it('includes a matching current-session job after durable history completed', () => {
    const key = jobKey({ providerId: 'p1', jobId: 'live-job' });
    const rows = filterJobHistory(
      selectJobHistoryRows(
        [{ ...summary(), providerId: 'p1' }],
        new Map<string, ProcessingJobStatus>([
          [
            key,
            { jobId: 'live-job', state: 'running', resultState: 'waiting' },
          ],
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
        ])
      ),
      { statuses: ['running'], task: 'threshold' }
    );
    expect(rows.map((row) => row.jobId)).toEqual(['live-job']);
    expect(rows[0].providerId).toBe('p1');
  });

  it('retains and renders a current-session error tail after union filtering', () => {
    const key = jobKey({ providerId: 'p1', jobId: 'live-error' });
    const rows = filterJobHistory(
      selectJobHistoryRows(
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
        ])
      ),
      { statuses: ['error'] }
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].providerId).toBe('p1');
    expect(rows[0].errorTail).toBe('Concrete worker failure: invalid mask');
  });

  it('clear is client-only and restores all fully loaded summaries', () => {
    expect(filterJobHistory(jobs, {})).toEqual(jobs);
  });
});
