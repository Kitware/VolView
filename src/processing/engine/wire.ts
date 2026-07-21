import { z } from 'zod';
import {
  neutralJobStatusSchema,
  jobHistoryPageSchema,
  jobHistoryDetailSchema,
  jobResultsSchema,
  type JobHistoryPage,
  type JobHistoryDetail,
} from '@/backend-contract';
import type {
  ProcessingJobRef,
  ProcessingJobStatus,
  JobResultsBundle,
  ProcessingResult,
} from '@/src/processing/types';

const jobStatusSchema = neutralJobStatusSchema.and(
  z.object({ jobId: z.string().min(1) }).passthrough()
) satisfies z.ZodType<ProcessingJobStatus>;

// The initial status is validated separately so a malformed born-terminal
// status becomes a terminal error instead of failing the whole ref.
const jobRefEnvelopeSchema = z.object({
  jobId: z.string().min(1),
  status: z.unknown().optional(),
});

// The client constructs no URI, so an empty response fails closed rather than
// minting a labelmap value with no provenance.
const stageResponseSchema = z.object({
  uris: z.array(z.string()).min(1),
});

const formatIssues = (error: z.ZodError): string =>
  error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');

const parseOrThrow =
  <S extends z.ZodType>(schema: S, label: string) =>
  (raw: unknown): z.output<S> => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `Malformed ${label} from provider: ${formatIssues(parsed.error)}`
      );
    }
    return parsed.data;
  };

const parseJobRefEnvelope = parseOrThrow(jobRefEnvelopeSchema, 'job ref');
const parseResultsEnvelope = parseOrThrow(jobResultsSchema, 'job results');
const parseStageEnvelope = parseOrThrow(
  stageResponseSchema,
  'staging response'
);

// An invalid payload becomes a terminal error status so the poller stops
// instead of looping forever on an unknown state.
export const parseJobStatus = (
  jobId: string,
  raw: unknown
): ProcessingJobStatus => {
  const parsed = jobStatusSchema.safeParse(raw);
  // The store keys its job map off `status.jobId`, so a provider returning a
  // different id would record the job under the wrong key.
  if (parsed.success) return { ...parsed.data, jobId };
  return {
    jobId,
    state: 'error',
    resultState: 'unavailable',
    errorTail: `Malformed job status from provider: ${formatIssues(parsed.error)}`,
  };
};

export const parseJobRef = (raw: unknown): ProcessingJobRef => {
  const { jobId, status } = parseJobRefEnvelope(raw);
  // `null` is a common serialization of an omitted optional field, so treat it
  // as absent rather than as a malformed born-terminal status.
  return status == null
    ? { jobId }
    : { jobId, status: parseJobStatus(jobId, status) };
};

export const parseResults = (raw: unknown): JobResultsBundle => {
  const envelope = parseResultsEnvelope(raw);
  // The wire allows null metadata; `ProcessingResult` uses `undefined`.
  const results: ProcessingResult[] = envelope.intents.map((row) => {
    const { mimeType, size, ...rest } = row as Record<string, unknown>;
    return {
      ...rest,
      ...(mimeType != null ? { mimeType } : {}),
      ...(size != null ? { size } : {}),
    } as ProcessingResult;
  });
  return {
    results,
    missing: envelope.missing,
  };
};

export const parseStageResponse = (raw: unknown): string[] =>
  parseStageEnvelope(raw).uris;

export const parseJobHistoryPage: (raw: unknown) => JobHistoryPage =
  parseOrThrow(jobHistoryPageSchema, 'job history page');

export const parseJobHistoryDetail: (raw: unknown) => JobHistoryDetail =
  parseOrThrow(jobHistoryDetailSchema, 'job history detail');
