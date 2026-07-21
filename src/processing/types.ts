import type { TaskSpecEnvelope } from '@/src/processing/engine/taskSpec';
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

export { JOB_STATES };
export type { JobState };

export const isTerminalJobState = (state: JobState): boolean =>
  state === 'success' || state === 'error' || state === 'cancelled';

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
  // Job-addressed routes live on a context-free surface, so an absent value is a
  // configuration error rather than a fallback onto baseUrl.
  jobsBaseUrl: string;
};

// Two context-scoped providers may each mint the same raw jobId, so the id alone
// cannot key a job-owned collection.
export type TrackedJobRef = {
  providerId: string;
  jobId: string;
};

// Provider ids contain colons, so a delimiter-joined key would be ambiguous.
export const jobKey = ({ providerId, jobId }: TrackedJobRef): string =>
  JSON.stringify([providerId, jobId]);

export type ProcessingProvider = {
  config: ProcessingProviderConfig;

  listTasks: () => Promise<TaskSummary[]>;
  getTaskSpec: (taskId: string) => Promise<TaskSpecEnvelope>;
  runTask: (
    taskId: string,
    values: Record<string, ProcessingValue>
  ) => Promise<ProcessingJobRef>;
  getJob: (jobId: string) => Promise<ProcessingJobStatus>;
  getResults: (jobId: string) => Promise<JobResultsBundle>;
  // Returns a projected status only; the poller converges the UI, since a job may
  // finish before the cancel lands.
  cancelJob: (jobId: string) => Promise<ProcessingJobStatus>;
  deleteJob: (jobId: string) => Promise<void>;
  stageInput: (request: StageInputRequest) => Promise<string[]>;
  listJobHistory: (cursor?: string) => Promise<JobHistoryPage>;
  getJobHistoryDetail: (jobId: string) => Promise<JobHistoryDetail>;
};

export type TaskSummary = {
  id: string;
  title: string;
  description?: string;
  category?: string[];
};

export type ProcessingValue =
  | string
  | number
  | boolean
  | string[]
  | number[]
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
  // A synchronous backend can return an already-terminal job, which skips the
  // poller; absent status means the job is treated as pending and polled.
  status?: ProcessingJobStatus;
};

export type ProcessingSegmentDescriptor = SegmentDescriptor;

export type ProcessingResult = {
  id: string;
  name: string;
  url: string;
  // Typed loosely because it arrives as untrusted wire JSON; unknown or malformed
  // values carry no state directive.
  intent?: string;
  mimeType?: string;
  size?: number;
  segments?: ProcessingSegmentDescriptor[];
  // Display provenance only; nothing keys dedup or attach semantics off it.
  source?: ResultSource;
};

// `missing` is reported rather than dropped so "success with no outputs" stays
// distinct from "outputs deleted".
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

// Remembered at submission time so result outputs auto-attach to the originating
// dataset.
export type SubmittedJobContext = {
  jobId: string;
  taskId: string;
  providerId: string;
  submittedAt: string;
  activeDatasetId?: string;
  display?: SubmittedJobDisplay;
};
