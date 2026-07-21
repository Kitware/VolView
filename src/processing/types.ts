// ---------------------------------------------------------------------------
// Provider contract — VolView core consumes these types only.
//
// One engine speaks to the paired processing backend through this client
// contract. The provider is composed by `engine/provider.ts` from the one
// required transport (`engine/transport.ts`).
// ---------------------------------------------------------------------------

// Type-only import (erased at runtime — no import cycle with the engine).
import type { TaskSpecEnvelope } from '@/src/processing/engine/taskSpec';
// The neutral input value the client mints from provenance at submit.
// `{ type, format?, uris }`.
import type {
  InputValue,
  StageInputDescriptor,
  JobState,
  ResultState,
  JobHistoryPage,
  JobHistoryDetail,
  ResultSource,
  SegmentDescriptor,
} from '@/backend-contract';
import { JOB_STATES } from '@/backend-contract';

// The contract (`backend-contract/processing/wire.ts`) is the ONE normative definition of
// the shared wire vocabulary. Re-export its job-lifecycle tuple + type here so the
// client binds to that single source of truth instead of redeclaring it.
// `JOB_STATES` is the runtime tuple; `JobState` the neutral union.
export { JOB_STATES };
export type { JobState };

// The one "job has settled" predicate. A job is terminal once it can no longer
// change state — success, error, or cancelled. Mirrors the backend's
// `isTerminalStatus` chokepoint so the client never re-spells the triple.
export const isTerminalJobState = (state: JobState): boolean =>
  state === 'success' || state === 'error' || state === 'cancelled';

// The single "provider failed the job but gave no details" fallback string.
// Shared by the store's terminal-message path and the JobList error summary so
// the two can never drift.
export const missingJobErrorDetails = (jobId: string): string =>
  `The provider reported this job failed but did not include error details. Job ID: ${jobId}`;

export type StageInputRequest = {
  file: Blob;
  descriptor: StageInputDescriptor;
};

export type ProcessingProviderConfig = {
  id: string;
  label: string;
  baseUrl: string;
  // REQUIRED explicit base for the job-addressed routes (status/results/cancel),
  // which are keyed by job id alone and served off a folder-free surface. The
  // backend always advertises `/api/v1/volview_processing`; the transport has no
  // baseUrl fallback, so a config missing it is a configuration error, not a
  // silent mis-route onto the folder-scoped baseUrl.
  jobsBaseUrl: string;
};

// A client-side job reference. Job identity is always the pair
// `(providerId, jobId)`: two folder-scoped providers may each mint the same raw
// `jobId` (e.g. both return "1"), so a raw id alone can never key a job-owned
// collection. The raw `jobId` is used only when calling that job's own provider.
export type TrackedJobRef = {
  providerId: string;
  jobId: string;
};

// The one stable key helper for every job-owned map/set. JSON-array
// serialization of the two strings is unambiguous regardless of characters
// embedded in either (the provider id itself contains a colon).
export const jobKey = ({ providerId, jobId }: TrackedJobRef): string =>
  JSON.stringify([providerId, jobId]);

export type ProcessingProvider = {
  config: ProcessingProviderConfig;

  listTasks: () => Promise<TaskSummary[]>;
  // Server-emitted, zod-validated task description. The engine renders the
  // parameter form from this — it parses no XML at runtime.
  getTaskSpec: (taskId: string) => Promise<TaskSpecEnvelope>;
  runTask: (
    taskId: string,
    values: Record<string, ProcessingValue>
  ) => Promise<ProcessingJobRef>;
  getJob: (jobId: string) => Promise<ProcessingJobStatus>;
  // The result-read envelope (`{intents, missing}`): the resolved results PLUS a
  // count of recorded outputs the backend could not
  // resolve. The store surfaces a partial-loss warning on a non-zero count while
  // still applying the results that resolved.
  getResults: (jobId: string) => Promise<JobResultsBundle>;
  // Best-effort cancel of a tracked job. One neutral engine call: the caller
  // holds no Girder route/id/JobStatus knowledge. Returns the job's projected
  // status after the attempt, but the store's poller — not this return — is what
  // converges the UI on whatever terminal state the backend ultimately reports (a
  // job may finish before the cancel lands, so `cancelled` is never fabricated).
  cancelJob: (jobId: string) => Promise<ProcessingJobStatus>;
  deleteJob: (jobId: string) => Promise<void>;
  // Stage a serialized segment group together with its neutral reference-image
  // provenance, returning the backend-minted URIs the client round-trips as a
  // `{ type: "labelmap", uris }` value.
  stageInput: (request: StageInputRequest) => Promise<string[]>;
  // Durable job-history re-discovery. Returns the launch context's jobs as
  // neutral summaries (jobId, taskId/taskTitle, createdBy/createdAt, state,
  // resultState, outputSummary, and optional startedAt/finishedAt/progress) —
  // no route, no JobStatus enum, no file id. The store calls it on load to
  // repopulate the Jobs panel + poller after a reload.
  listJobHistory: (cursor?: string) => Promise<JobHistoryPage>;
  getJobHistoryDetail: (jobId: string) => Promise<JobHistoryDetail>;
};

// Advisory display metadata for the task picker (id/title + optional hints).
// The backend emits it; the engine passes it through without a schema.
export type TaskSummary = {
  id: string;
  title: string;
  description?: string;
  dockerImage?: string;
  category?: string[];
};

export type ProcessingValue =
  | string
  | number
  | boolean
  | string[]
  | number[]
  // Input value minted from the bound volume's own DataSource provenance —
  // the value a `sourceRef` param carries.
  | InputValue
  | null;

export type ProcessingJobStatus = {
  jobId: string;
  state: JobState;
  resultState: ResultState;
  progress?: number;
  errorTail?: string;
};

export type ProcessingJobRef = {
  jobId: string;
  /**
   * Optional initial status. The async lifecycle has a synchronous fast-path:
   * a provider's `runTask` may return a job that is already terminal ("born
   * terminal" — e.g. a synchronous `/infer` backend). When the
   * status is terminal the store routes it through the same completion path as a
   * polled job (auto-apply hook, JobList rendering) but never registers a
   * poller. When absent the job is treated as `pending` and polled — polling
   * stays the driver for non-terminal jobs, unchanged.
   */
  status?: ProcessingJobStatus;
};

// The segment descriptor shape is the contract's canonical `SegmentDescriptor`
// (`backend-contract/processing/wire.ts`) — aliased here rather than redeclared so the two
// cannot drift. RGBA 0-255; `value` a label index >= 1.
export type ProcessingSegmentDescriptor = SegmentDescriptor;

export type ProcessingResult = {
  id: string;
  name: string;
  url: string;
  /**
   * Provider-supplied result intent — the neutral v1 vocabulary the single
   * applier applies (`backend-contract/processing/wire.ts`). Typed
   * loosely because it arrives as untrusted wire JSON; `resultToIntent`
   * resolves it against the canonical schema. Missing, unknown, or malformed
   * values carry no VolView state directive.
   */
  intent?: string;
  mimeType?: string;
  size?: number;
  /**
   * Provider-supplied segment descriptors. Only meaningful for an
   * `add-segment-group` intent. When present, VolView applies these
   * names/colors to the created segment group instead of auto-generating.
   */
  segments?: ProcessingSegmentDescriptor[];
  /**
   * Provenance tag the backend stamps on an `add-segment-group` result
   * (`{ jobId, outputId }`). The applier threads it onto the created segment
   * group so it round-trips the `.volview.zip` as DISPLAY PROVENANCE only
   * (nothing keys dedup or attach semantics off it). Structurally
   * the `source?` field on `SegmentGroupMetadata`.
   */
  source?: ResultSource;
};

// The result-read envelope the engine hands the store (`jobResultsSchema`):
// the parsed results plus a count of declared outputs the backend could not
// publish or resolve. `missing`
// is reported rather than silently dropped so a "success with no outputs" stays
// distinct from "outputs deleted", and the store can surface a partial-loss
// warning alongside the results that did resolve. Distinct from the
// re-association `baseImageMissing` signal — a different concept.
export type JobResultsBundle = {
  results: ProcessingResult[];
  missing: number;
};

export type SubmittedJobParameterDisplay = {
  id: string;
  label: string;
  value: string;
  summary?: boolean;
};

export type SubmittedJobDisplay = {
  taskTitle: string;
  inputName?: string;
  parameters: SubmittedJobParameterDisplay[];
};

// VolView remembers which dataset / source was active at submission time so
// result outputs auto-attach to the originating dataset.
export type SubmittedJobContext = {
  jobId: string;
  taskId: string;
  providerId: string;
  submittedAt: string;
  activeDatasetId?: string;
  display?: SubmittedJobDisplay;
};
