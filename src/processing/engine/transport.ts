// `$fetch` attaches the same-origin bearer that raw `fetch` would omit.

import { z } from 'zod';
import { pathSegmentIdSchema } from '@/backend-contract';
import { $fetch } from '@/src/utils/fetch';
import type {
  ProcessingProvider,
  ProcessingProviderConfig,
  TaskSummary,
} from '@/src/processing/types';
import { parseTaskSpecEnvelope } from './taskSpec';
import {
  parseJobHistoryPage,
  parseJobHistoryDetail,
  parseJobRef,
  parseJobStatus,
  parseResults,
  parseStageResponse,
} from './wire';

// One malformed task summary must not kill the whole picker.
const taskSummarySchema = z.object({
  id: pathSegmentIdSchema,
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

const join = (base: string, path: string) =>
  `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

const id = (taskOrJobId: string) =>
  encodeURIComponent(pathSegmentIdSchema.parse(taskOrJobId));

// Status rides on the error so the poller can classify the failure.
export type HttpError = Error & {
  status: number;
  code?: string;
  body?: unknown;
};

const requestJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const res = await $fetch(url, {
    credentials: 'same-origin',
    ...init,
  });
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
  const res = await $fetch(url, {
    credentials: 'same-origin',
    ...init,
  });
  if (!res.ok) {
    const err = new Error(
      `Request failed: ${res.status} ${res.statusText}`
    ) as HttpError;
    err.status = res.status;
    throw err;
  }
};

export type EngineTransport = Omit<ProcessingProvider, 'config'>;

export const createEngineTransport = (
  config: ProcessingProviderConfig
): EngineTransport => {
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
