// ---------------------------------------------------------------------------
// The one required processing transport.
//
// There is exactly ONE backend interaction model: the paired Girder backend's
// fixed routes, `{ values }` JSON run body, poll lifecycle, and canonical wire
// parsers. This module implements them directly — there is no swappable
// descriptor, no capability-gating, and no unbuilt lifecycle branch. Every
// operation is required and always present.
//
// The launch-context routes (tasks / spec / run / stage / history) are addressed
// off the folder-scoped `baseUrl`; the job-addressed routes (status / results /
// cancel / delete / detail) off the folder-free `jobsBaseUrl`.
//
// All engine HTTP goes through `$fetch` (src/utils/fetch.ts), the origin-aware
// authenticated wrapper that attaches the same-origin bearer. Raw `fetch` would
// bypass that header, so it is never used here.
//
// House rules: functional style; `type`, not `interface`.
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { $fetch } from '@/src/utils/fetch';
import type { JobHistoryDetail, JobHistoryPage } from '@/backend-contract';
import type {
  ProcessingJobRef,
  ProcessingJobStatus,
  JobResultsBundle,
  ProcessingValue,
  StageInputRequest,
  TaskSummary,
  ProcessingProviderConfig,
} from '@/src/processing/types';
import type { TaskSpecEnvelope } from './taskSpec';
import { parseTaskSpecEnvelope } from './taskSpec';
import {
  parseJobHistoryPage,
  parseJobHistoryDetail,
  parseJobRef,
  parseJobStatus,
  parseResults,
  parseStageResponse,
} from './wire';

// ---------------------------------------------------------------------------
// Task-summary parsing — advisory pass-through, fail SOFT
//
// Task summaries are advisory display metadata for the picker, not contract
// vocabulary, so this is a LIGHT, lenient guard — not the wire validators. It
// requires only the two fields the picker cannot render without (id/title) and
// keeps every other advisory hint (description/dockerImage/category) verbatim. A
// malformed entry is DROPPED WITH A WARNING, never thrown on: one bad summary
// must never kill the whole picker. A non-array payload degrades to an empty
// list. Deliberately VolView's own light zod schema, NOT one derived from the
// contract wire schemas.
// ---------------------------------------------------------------------------
const taskSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
});

const parseTaskSummaries = (raw: unknown): TaskSummary[] => {
  if (!Array.isArray(raw)) {
    console.warn('processing: task list was not an array; ignoring it');
    return [];
  }
  return raw.filter((entry): entry is TaskSummary => {
    const parsed = taskSummarySchema.safeParse(entry);
    if (!parsed.success) {
      console.warn('processing: dropping malformed task summary', entry);
    }
    return parsed.success;
  });
};

// Route helpers. Every template is a plain join — no route-root string surgery.
const join = (base: string, path: string) =>
  `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

const id = (taskOrJobId: string) => encodeURIComponent(taskOrJobId);

// ---------------------------------------------------------------------------
// $fetch helpers — bearer-aware, never raw fetch
// ---------------------------------------------------------------------------

// The HTTP status rides on the thrown error so the job poller can classify it
// (transient vs permanent vs session-expiry vs resource-gone; store/providers.ts
// `classifyError`). A rejected `$fetch` (offline / DNS) carries no status and is
// treated as transient. Functional style: a plain `Error` with a `status` field,
// not an Error subclass.
export type HttpError = Error & {
  status: number;
  code?: string;
  body?: unknown;
};

const requestJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const res = await $fetch(url, { credentials: 'same-origin', ...init });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    const err = new Error(
      `Request failed: ${res.status} ${res.statusText} ${text}`
    ) as HttpError;
    err.status = res.status;
    err.body = body;
    if (body && typeof body === 'object' && 'code' in body) {
      const code = (body as { code?: unknown }).code;
      if (typeof code === 'string') err.code = code;
    }
    throw err;
  }
  return res.json() as Promise<T>;
};

const requestEmpty = async (url: string, init: RequestInit): Promise<void> => {
  const res = await $fetch(url, { credentials: 'same-origin', ...init });
  if (!res.ok) {
    const err = new Error(
      `Request failed: ${res.status} ${res.statusText}`
    ) as HttpError;
    err.status = res.status;
    throw err;
  }
};

// ---------------------------------------------------------------------------
// The transport — every operation required and always present
// ---------------------------------------------------------------------------

export type EngineTransport = {
  listTasks: () => Promise<TaskSummary[]>;
  getTaskSpec: (taskId: string) => Promise<TaskSpecEnvelope>;
  runTask: (
    taskId: string,
    values: Record<string, ProcessingValue>
  ) => Promise<ProcessingJobRef>;
  getJob: (jobId: string) => Promise<ProcessingJobStatus>;
  getResults: (jobId: string) => Promise<JobResultsBundle>;
  // Best-effort cancel. POSTs to the cancel route and validates the projected
  // status through the SAME neutral status parser as polling, so a best-effort
  // backend that already finished honestly reports its real terminal state
  // (never a fabricated `cancelled`).
  cancelJob: (jobId: string) => Promise<ProcessingJobStatus>;
  deleteJob: (jobId: string) => Promise<void>;
  // Stage a parent-bound labelmap as a transient input, returning the
  // backend-minted URIs.
  stageInput: (request: StageInputRequest) => Promise<string[]>;
  // Durable job re-discovery. Context-scoped (folder-scoped baseUrl).
  listJobHistory: (cursor?: string) => Promise<JobHistoryPage>;
  getJobHistoryDetail: (jobId: string) => Promise<JobHistoryDetail>;
};

export const createEngineTransport = (
  config: ProcessingProviderConfig
): EngineTransport => {
  // Launch-context routes ride the folder-scoped baseUrl; job-addressed routes
  // ride the folder-free jobsBaseUrl (both required on the config — no fallback).
  const { baseUrl, jobsBaseUrl } = config;
  return {
    listTasks: async () =>
      parseTaskSummaries(await requestJson(join(baseUrl, 'tasks'))),

    getTaskSpec: async (taskId) =>
      parseTaskSpecEnvelope(
        await requestJson(join(baseUrl, `tasks/${id(taskId)}/spec`))
      ),

    runTask: async (taskId, values) =>
      parseJobRef(
        await requestJson(join(baseUrl, `tasks/${id(taskId)}/run`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values }),
        })
      ),

    getJob: async (jobId) =>
      parseJobStatus(
        jobId,
        await requestJson(join(jobsBaseUrl, `jobs/${id(jobId)}`))
      ),

    getResults: async (jobId) =>
      parseResults(
        await requestJson(join(jobsBaseUrl, `jobs/${id(jobId)}/results`))
      ),

    cancelJob: async (jobId) =>
      parseJobStatus(
        jobId,
        await requestJson(join(jobsBaseUrl, `jobs/${id(jobId)}/cancel`), {
          method: 'POST',
        })
      ),

    deleteJob: async (jobId) => {
      await requestEmpty(join(jobsBaseUrl, `jobs/${id(jobId)}`), {
        method: 'DELETE',
      });
    },

    stageInput: async (request) => {
      const body = new FormData();
      body.append('file', request.file, request.descriptor.name);
      body.append('descriptor', JSON.stringify(request.descriptor));
      return parseStageResponse(
        await requestJson<unknown>(join(baseUrl, 'stage'), {
          method: 'POST',
          body,
        })
      );
    },

    listJobHistory: async (cursor) => {
      const url = join(baseUrl, 'jobs');
      return parseJobHistoryPage(
        await requestJson(
          cursor ? `${url}?cursor=${encodeURIComponent(cursor)}` : url
        )
      );
    },

    getJobHistoryDetail: async (jobId) =>
      parseJobHistoryDetail(
        await requestJson(join(jobsBaseUrl, `jobs/${id(jobId)}/detail`))
      ),
  };
};
