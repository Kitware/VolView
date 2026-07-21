// ---------------------------------------------------------------------------
// Parity mechanism (single source): generate a JSON Schema from the zod
// source so the Python/backend side validates the SAME golden fixtures against
// the SAME normative definition — one schema, two validators — instead of a
// hand-maintained second copy.
//
// NOTE: this is the INTERNAL zod->JSON-Schema for fixture parity, NOT a
// third-party-facing JSON-Schema *view* of the task spec. The generated files
// here exist only so the backend tests can validate the shared fixtures.
//
// zod's cross-field refinements (min<=max, default-in-range, enum default) are
// NOT representable in JSON Schema; `unrepresentable: 'any'` drops them from the
// generated structural schema. Those constraints stay the zod side's extra
// rigor (exercised by the negative constraint-violation fixture in vitest).
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { taskSpecSchema } from './task-spec';
import {
  inputValueSchema,
  stageInputDescriptorSchema,
  neutralJobStatusSchema,
  resultIntentSchema,
  jobHistorySummarySchema,
  jobHistoryPageSchema,
  jobHistoryDetailSchema,
  jobResultsSchema,
  jobResultsErrorSchema,
} from './wire';

const schemas = {
  'task-spec': taskSpecSchema,
  'input-value': inputValueSchema,
  'stage-input-descriptor': stageInputDescriptorSchema,
  'neutral-job-status': neutralJobStatusSchema,
  'result-intent': resultIntentSchema,
  'job-history-summary': jobHistorySummarySchema,
  'job-history-page': jobHistoryPageSchema,
  'job-history-detail': jobHistoryDetailSchema,
  'job-results': jobResultsSchema,
  'job-results-error': jobResultsErrorSchema,
} as const;

export type GeneratedSchemaName = keyof typeof schemas;

export const generateJsonSchemas = (): Record<GeneratedSchemaName, unknown> =>
  Object.fromEntries(
    Object.entries(schemas).map(([name, schema]) => [
      name,
      z.toJSONSchema(schema, { unrepresentable: 'any' }),
    ])
  ) as Record<GeneratedSchemaName, unknown>;

export const GENERATED_SCHEMA_NAMES = Object.keys(
  schemas
) as GeneratedSchemaName[];
