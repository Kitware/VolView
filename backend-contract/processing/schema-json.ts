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
// NOT representable in standard JSON Schema; `unrepresentable: 'any'` drops
// them from the generated structural schema. A backend MUST follow task-spec
// JSON-Schema validation with `validateTaskSpecSemantics` (or an equivalent
// implementation) and run every negative fixture as a conformance suite.
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
type JsonSchema = z.core.JSONSchema.JSONSchema;

// z.toJSONSchema renders a fixed-length z.tuple (color RGBA, bounds) as bare
// `prefixItems`, which JSON Schema treats as a prefix constraint only — a
// wrong-length array still validates, while the normative zod rejects it.
// Close every tuple to its exact length so both validators agree. A tuple
// with a rest element would carry `items`; leave its maxItems open.
const closeTupleLengths = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(closeTupleLengths);
  if (node === null || typeof node !== 'object') return node;
  const walked = Object.fromEntries(
    Object.entries(node as Record<string, unknown>).map(([key, value]) => [
      key,
      closeTupleLengths(value),
    ])
  );
  if (!Array.isArray(walked.prefixItems)) return walked;
  return {
    minItems: walked.prefixItems.length,
    ...('items' in walked ? {} : { maxItems: walked.prefixItems.length }),
    ...walked,
  };
};

export const generateJsonSchemas = (): Record<
  GeneratedSchemaName,
  JsonSchema
> =>
  Object.fromEntries(
    Object.entries(schemas).map(([name, schema]) => [
      name,
      name === 'task-spec'
        ? {
            $comment:
              'Structural validation only. Implement backend-contract validateTaskSpecSemantics after this schema and reject every fixtures/negative payload.',
            ...(closeTupleLengths(
              z.toJSONSchema(schema, { unrepresentable: 'any' })
            ) as JsonSchema),
          }
        : closeTupleLengths(z.toJSONSchema(schema, { unrepresentable: 'any' })),
    ])
  ) as Record<GeneratedSchemaName, JsonSchema>;

export const GENERATED_SCHEMA_NAMES = Object.keys(
  schemas
) as GeneratedSchemaName[];
