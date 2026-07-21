// ---------------------------------------------------------------------------
// Engine wire validation.
//
// The engine speaks HTTP to an untrusted backend: every job status, job ref, and
// result list arrives as wire JSON. Before this module those payloads were
// `fetchJson<T>` casts straight to typed shapes, so an unknown/missing `state`
// (or a born-terminal ref carrying a garbage status) slipped past the type
// system and made the poller (`store/providers.ts`) loop forever — never
// terminal, never error. This module validates each payload with zod and
// converts an unparseable status into a *terminal error* status so the lifecycle
// stops instead of spinning.
//
// These are the neutral result-format validators the transport calls directly
// — not backend-specific parsing.
//
// Layering note: a result row with an out-of-range segment descriptor is not a
// hard failure — the canonical `resultIntentSchema` union simply demotes it from
// the strict `add-segment-group` member to the fail-open ordinary branch, so it
// stays a visible result that carries no state action, and one bad descriptor
// never rejects the whole list and drops an otherwise-valid base image.
//
// Pure module: zod schemas + parse helpers only, no fetch and no store access.
//
// House rules: functional style; `type`, not `interface`.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Schemas
//
// These are DERIVED from the contract's canonical objects (the ONE normative
// definition, `backend-contract/processing/wire.ts`) — extended/loosened rather than
// re-declared — so the client's wire layer cannot drift from the contract
// (dedupe). `passthrough()` keeps unknown keys so a valid payload
// round-trips byte-identically — the happy path must not change shape.
// ---------------------------------------------------------------------------

// Derived from the contract's `neutralJobStatusSchema`: the engine tightens only
// `jobId` (a usable id is mandatory at the trust boundary — nothing can be tracked
// or completion-keyed without it; the contract leaves it a plain producer-side
// string), inheriting `state`/`progress`/`errorTail` unchanged. `satisfies` pins
// the schema to the core type (same idiom as `config.ts`) so the two cannot drift.
const jobStatusSchema = neutralJobStatusSchema.and(
  z.object({ jobId: z.string().min(1) }).passthrough()
) satisfies z.ZodType<ProcessingJobStatus>;

// The result-read envelope is the contract's canonical `jobResultsSchema`, used
// DIRECTLY (no private client copy): every row is a `resultListItem`
// (id/name/url + optional/null metadata) that either matched a known intent or
// fell through to the ordinary branch. A single out-of-range segment descriptor
// no longer needs a loosened client schema — it simply demotes that one row to
// the fail-open ordinary branch (visible, no state action) rather than rejecting
// the whole list. So there is no payload the contract accepts but this parser
// rejects.

// The job ref envelope: a usable job id is mandatory (nothing can be tracked
// without it); the optional initial status is validated separately so a
// malformed born-terminal status becomes a terminal error instead of failing
// the whole ref.
const jobRefEnvelopeSchema = z.object({
  jobId: z.string().min(1),
  status: z.unknown().optional(),
});

// The staging response for client-created labelmap inputs: the
// backend mints `{ uris }` for the bytes the client POSTed. At least one URI is
// mandatory — the client CONSTRUCTS no URI, so an empty/malformed response must
// fail closed rather than mint a labelmap value with no provenance.
const stageResponseSchema = z.object({
  uris: z.array(z.string()).min(1),
});

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

const formatIssues = (error: z.ZodError): string =>
  error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');

// Validate a wire job status. A valid payload round-trips unchanged; an invalid
// one becomes a *terminal* error status (keyed to the requested `jobId`) so the
// poller stops instead of looping forever on an unknown state.
export const parseJobStatus = (
  jobId: string,
  raw: unknown
): ProcessingJobStatus => {
  const parsed = jobStatusSchema.safeParse(raw);
  // Pin the status to the *requested* jobId on both branches. The store keys
  // its job map and submitted-context lookup off `status.jobId`, so a provider
  // that returned a different id would record the job under the wrong key (UI
  // never sees the terminal state, result auto-attach context is lost). The
  // error branch already does this; the success branch must match.
  if (parsed.success) return { ...parsed.data, jobId };
  return {
    jobId,
    state: 'error',
    resultState: 'unavailable',
    errorTail: `Malformed job status from provider: ${formatIssues(parsed.error)}`,
  };
};

// Validate a wire job ref. The job id must parse (otherwise nothing can be
// tracked — throw). A present-but-malformed initial status is routed through
// `parseJobStatus`, so a garbage born-terminal status surfaces as a terminal
// error rather than an infinite poll.
export const parseJobRef = (raw: unknown): ProcessingJobRef => {
  const parsed = jobRefEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Malformed job ref from provider: ${formatIssues(parsed.error)}`
    );
  }
  const { jobId, status } = parsed.data;
  // Treat an explicit `status: null` as an absent status (poll it), not a
  // malformed born-terminal status: `null` is a common JSON serialization of an
  // omitted optional field, and `z.unknown().optional()` preserves it as a
  // present value, so a bare `=== undefined` check would flag it as garbage.
  return status == null
    ? { jobId }
    : { jobId, status: parseJobStatus(jobId, status) };
};

// Validate a wire result-read envelope into the neutral `{results, missing}`
// bundle. There is no poll to redirect here, so a
// malformed payload throws; the store's completion path already catches it,
// logs, and notifies subscribers with no results.
export const parseResults = (raw: unknown): JobResultsBundle => {
  const parsed = jobResultsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Malformed job results from provider: ${formatIssues(parsed.error)}`
    );
  }
  // Normalize null metadata to absent AFTER canonical parsing — the internal UI
  // type (`ProcessingResult`) uses `undefined`, while the wire allows null.
  const results: ProcessingResult[] = parsed.data.intents.map((row) => {
    const { mimeType, size, ...rest } = row as Record<string, unknown>;
    return {
      ...rest,
      ...(mimeType != null ? { mimeType } : {}),
      ...(size != null ? { size } : {}),
    } as ProcessingResult;
  });
  return {
    results,
    missing: parsed.data.missing,
  };
};

// Validate a staging response into the backend-minted URIs. A malformed/empty
// response throws so the caller never mints a `{ type:"labelmap", uris }` value
// with no provenance (the client constructs no URI).
export const parseStageResponse = (raw: unknown): string[] => {
  const parsed = stageResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Malformed staging response from provider: ${formatIssues(parsed.error)}`
    );
  }
  return parsed.data.uris;
};

// Validate a wire job-history page. A
// malformed listing throws so re-discovery fails loud rather than re-attaching
// against a garbage handle; the store treats any listing failure as "no
// re-discovery" and degrades to in-session replay (a re-discovery failure is
// never fatal to the session).
export const parseJobHistoryPage = (raw: unknown): JobHistoryPage => {
  const parsed = jobHistoryPageSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Malformed job history page from provider: ${formatIssues(parsed.error)}`
    );
  }
  return parsed.data;
};

export const parseJobHistoryDetail = (raw: unknown): JobHistoryDetail => {
  const parsed = jobHistoryDetailSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Malformed job history detail from provider: ${formatIssues(parsed.error)}`
    );
  }
  return parsed.data;
};
