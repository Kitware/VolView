// ---------------------------------------------------------------------------
// Neutral wire shapes shared between the client and any backend. Same neutral
// shapes everywhere: never a backend file id, a route, or a Girder `JobStatus`
// enum.
//
// Two DIFFERENT fail-closed behaviors live here, on purpose:
//   * an unknown task-spec field kind is REJECTED (task-spec.ts, negative
//     fixture) — the client must not silently render a param it can't type;
//   * a missing, unknown, or malformed result INTENT is ACCEPTED as an
//     ordinary result record but carries no VolView state directive.
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { typeTagSchema } from './task-spec';

// Bump when the intent vocabulary's shape changes so producers and the applier
// can negotiate compatibility.
export const INTENT_VOCABULARY_VERSION = 1;

// ---------------------------------------------------------------------------
// Input value: what the client sends at submit
// ---------------------------------------------------------------------------

// The bound input's value: verbatim provenance URIs plus a SEMANTIC type tag.
// `type`/`format` are an open vocabulary (no closed server enum). `uris`
// are the client's own opaque provenance URIs in sorted slice order (advisory),
// and at least one is required — a bound input with no URIs is not a value
// (the client never mints one, and the backend rejects it with a 400).
export const inputValueSchema = z.object({
  type: typeTagSchema,
  format: z.string().optional(),
  uris: z.array(z.string()).min(1),
});

export type InputValue = z.infer<typeof inputValueSchema>;

// The typed descriptor that accompanies staged bytes. Staging creates a
// labelmap resource bound to the image it overlays; the image value is the
// same neutral, opaque-provenance shape used by ordinary task inputs.
export const stageInputDescriptorSchema = z.strictObject({
  type: z.literal('labelmap'),
  name: z.string().min(1),
  referenceImage: inputValueSchema
    .extend({
      type: z.literal('image'),
      uris: z.array(z.string()).min(1),
    })
    .strict(),
});

export type StageInputDescriptor = z.infer<typeof stageInputDescriptorSchema>;

// ---------------------------------------------------------------------------
// Neutral job status
// ---------------------------------------------------------------------------

// Exactly these five states, named to match what the backend projects and the
// client store consumes at runtime (`pending | running | success | error |
// cancelled`): typical backend job lifecycles map onto these with no translation
// layer, so the producer and the consumer already agree. `cancelled` is present
// so cancel needs no wire change; the terminal states (`success | error |
// cancelled`) also carry the born-terminal sync fast-path at zero cost.
export const JOB_STATES = [
  'pending',
  'running',
  'success',
  'error',
  'cancelled',
] as const;
export type JobState = (typeof JOB_STATES)[number];

export const jobStateSchema = z.enum(JOB_STATES);

export const RESULT_STATES = [
  'waiting',
  'ready',
  'incomplete',
  'unavailable',
] as const;
export type ResultState = (typeof RESULT_STATES)[number];

export const resultStateSchema = z.enum(RESULT_STATES);

const neutralJobStatusBaseSchema = z.object({
  jobId: z.string(),
  progress: z.number().optional(),
  errorTail: z.string().optional(),
});

export const neutralJobStatusSchema = z.discriminatedUnion('state', [
  neutralJobStatusBaseSchema.extend({
    state: z.literal('pending'),
    resultState: z.literal('waiting'),
  }),
  neutralJobStatusBaseSchema.extend({
    state: z.literal('running'),
    resultState: z.literal('waiting'),
  }),
  neutralJobStatusBaseSchema.extend({
    state: z.literal('success'),
    resultState: z.enum(['ready', 'incomplete']),
  }),
  neutralJobStatusBaseSchema.extend({
    state: z.literal('error'),
    resultState: z.literal('unavailable'),
  }),
  neutralJobStatusBaseSchema.extend({
    state: z.literal('cancelled'),
    resultState: z.literal('unavailable'),
  }),
]);

export type NeutralJobStatus = z.infer<typeof neutralJobStatusSchema>;

// ---------------------------------------------------------------------------
// Result-intent vocabulary
// ---------------------------------------------------------------------------

// The four state directives the applier understands.
export const RESULT_INTENTS = [
  'add-base-image',
  'add-layer',
  'add-segment-group',
  'restore-state',
] as const;
export type ResultIntentName = (typeof RESULT_INTENTS)[number];

export const isKnownIntent = (intent: string): intent is ResultIntentName =>
  (RESULT_INTENTS as readonly string[]).includes(intent);

// Provenance tag stamped on an applied segment group: an idempotency key.
// Structurally identical to the `source?` field on `SegmentGroupMetadata` so it
// round-trips the `.volview.zip`.
export const resultSourceSchema = z.object({
  jobId: z.string(),
  outputId: z.string(),
});
export type ResultSource = z.infer<typeof resultSourceSchema>;

// A single RGBA channel: an integer in [0, 255].
const colorChannel = z.number().int().min(0).max(255);

// A segment descriptor: `value` is a label index >= 1 (0 is reserved
// background), `color` is RGBA 0-255.
export const segmentDescriptorSchema = z.object({
  value: z.number().int().min(1),
  name: z.string(),
  color: z.tuple([colorChannel, colorChannel, colorChannel, colorChannel]),
  visible: z.boolean().optional(),
});
export type SegmentDescriptor = z.infer<typeof segmentDescriptorSchema>;

// The ONE canonical result-list-item shape, shared by every producer, the
// client, the generated OpenAPI, the fixtures, and the backend copy. `id` is the
// display key (required, nonempty); `name`/`url` are required; `mimeType`/`size`
// are advisory file metadata that may be null. Every intent branch is built FROM
// this shape, so there is no payload the contract accepts but the client rejects.
export const resultListItemSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  url: z.string(),
  mimeType: z.string().nullish(),
  size: z.number().nonnegative().nullish(),
});
export type ResultListItem = z.infer<typeof resultListItemSchema>;

// The four known intents are built from the common result-item shape.
// `.passthrough()` keeps an unrecognized extra producer field on a KNOWN intent
// (it survives round-trip but gains no behavior).
const addBaseImage = z
  .object({
    intent: z.literal('add-base-image'),
    ...resultListItemSchema.shape,
  })
  .passthrough();

const addLayer = z
  .object({ intent: z.literal('add-layer'), ...resultListItemSchema.shape })
  .passthrough();

// `add-segment-group` carries OPTIONAL `segments` (the bare-labelmap +
// labels-sidecar case; a `seg.nrrd` with embedded metadata carries none — the
// client uses `segments` when present, else the file's own metadata) and an
// optional `source` provenance tag (the idempotency key).
const addSegmentGroup = z
  .object({
    intent: z.literal('add-segment-group'),
    ...resultListItemSchema.shape,
    segments: z.array(segmentDescriptorSchema).optional(),
    source: resultSourceSchema.optional(),
  })
  .passthrough();

const restoreState = z
  .object({ intent: z.literal('restore-state'), ...resultListItemSchema.shape })
  .passthrough();

// The STRICT half of the vocabulary: exactly the four v1 state directives, each with its
// declared shape. Exported so the single applier can gate on which union member
// strictly matched — a name-known-but-shape-invalid result (e.g. a broken
// `segments`) carries no state directive rather than being applied as valid.
export const knownResultIntentSchema = z.discriminatedUnion('intent', [
  addBaseImage,
  addLayer,
  addSegmentGroup,
  restoreState,
]);

export type KnownResultIntent = z.infer<typeof knownResultIntentSchema>;

// The ordinary-result branch: missing, unknown, and malformed intent values
// still preserve the full result row (id/name/url required), but the client
// performs no state action. `.catchall` keeps any extra producer fields without
// interpreting them.
const unknownIntent = z
  .object({
    intent: z.unknown().optional(),
    ...resultListItemSchema.shape,
  })
  .catchall(z.unknown());

// One canonical result-row union — every row is a resultListItem that either
// matched a known intent or fell through to the ordinary branch.
export const resultIntentSchema = z.union([
  knownResultIntentSchema,
  unknownIntent,
]);

export type ResultIntent = z.infer<typeof resultIntentSchema>;

// ---------------------------------------------------------------------------
// Complete personal job history
// ---------------------------------------------------------------------------

export const jobHistorySummarySchema = z
  .object({
    jobId: z.string(),
    taskId: z.string(),
    taskTitle: z.string(),
    createdBy: z.object({ id: z.string(), name: z.string() }),
    createdAt: z.string(),
    startedAt: z.string().optional(),
    finishedAt: z.string().optional(),
    state: jobStateSchema,
    resultState: resultStateSchema,
    progress: z.number().min(0).max(1).optional(),
    outputSummary: z
      .object({
        recorded: z.number().int().nonnegative(),
        missing: z.number().int().nonnegative(),
      })
      .optional(),
  })
  .superRefine((summary, context) => {
    const lifecycle = neutralJobStatusSchema.safeParse({
      jobId: summary.jobId,
      state: summary.state,
      resultState: summary.resultState,
    });
    if (!lifecycle.success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['resultState'],
        message: `resultState ${summary.resultState} is invalid for ${summary.state}`,
      });
    }
  });

export type JobHistorySummary = z.infer<typeof jobHistorySummarySchema>;

export const jobHistoryPageSchema = z.object({
  jobs: z.array(jobHistorySummarySchema),
  nextCursor: z.string().nullable(),
});

export type JobHistoryPage = z.infer<typeof jobHistoryPageSchema>;

export const jobHistoryDetailSchema = z.object({
  jobId: z.string(),
  log: z.array(z.string()),
  parameters: z.record(z.string(), z.unknown()),
});

export type JobHistoryDetail = z.infer<typeof jobHistoryDetailSchema>;

// ---------------------------------------------------------------------------
// Result-read payloads
// ---------------------------------------------------------------------------

// A successful results read: the resolved intents plus a count of outputs the
// backend could not resolve (deleted files, etc.). `missing` is reported rather
// than silently dropped, so "succeeded with no outputs" stays distinguishable
// from "outputs deleted".
export const jobResultsSchema = z.object({
  resultState: z.enum(['ready', 'incomplete']),
  intents: z.array(resultIntentSchema),
  missing: z.number().int().nonnegative(),
});
export type JobResults = z.infer<typeof jobResultsSchema>;

// The explicit error the backend returns for a non-succeeded job, so the client
// never mistakes a failed/running read for empty results.
export const jobResultsErrorSchema = z.discriminatedUnion('code', [
  z.object({
    code: z.literal('results_not_ready'),
    message: z.string(),
    state: z.enum(['pending', 'running']),
    resultState: z.literal('waiting'),
  }),
  z.object({
    code: z.literal('results_unavailable'),
    message: z.string(),
    state: z.enum(['error', 'cancelled']),
    resultState: z.literal('unavailable'),
  }),
]);
export type JobResultsError = z.infer<typeof jobResultsErrorSchema>;
