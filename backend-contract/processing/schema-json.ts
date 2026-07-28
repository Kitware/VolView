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
  ANNOTATIONS_RESERVED_RECORD_KEY,
  ANNOTATION_TOOL_KINDS,
  annotationsFileSchema,
} from './annotations';
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
  'annotations-file': annotationsFileSchema,
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

const asRecord = (value: unknown): Record<string, unknown> =>
  value as Record<string, unknown>;

const descend = (
  root: Record<string, unknown>,
  path: readonly string[]
): Record<string, unknown> =>
  path.reduce((node, key) => asRecord(node[key]), root);

// Zod cannot preserve `__proto__` long enough for record-key validation, so
// the runtime schema checks the raw input. Carry the same rule explicitly in
// the generated structural artifact.
const reserveAnnotationsRecordKey = (schema: JsonSchema): JsonSchema => {
  ANNOTATION_TOOL_KINDS.forEach((kind) => {
    const records = [
      descend(asRecord(schema), ['properties', 'labels', 'properties', kind]),
      descend(asRecord(schema), [
        'properties',
        'tools',
        'properties',
        kind,
        'items',
        'properties',
        'metadata',
      ]),
    ];
    records.forEach((record) => {
      record.propertyNames = {
        ...asRecord(record.propertyNames),
        pattern: `^(?!${ANNOTATIONS_RESERVED_RECORD_KEY}$)`,
      };
    });
  });
  return schema;
};

// Schemas whose zod source carries cross-field rules JSON Schema cannot state.
// Each names the semantic pass a backend MUST run after structural validation,
// in the generated artifact itself so the obligation travels with the schema.
const SEMANTIC_PASS_COMMENTS: Partial<Record<GeneratedSchemaName, string>> = {
  'task-spec':
    'Structural validation only. Implement backend-contract validateTaskSpecSemantics after this schema and reject every fixtures/negative payload.',
  'annotations-file':
    'Structural validation only. Implement backend-contract validateAnnotationsFileSemantics after this schema: every planeNormal must be nonzero, and every nonempty labelName must be declared in its own tool-kind label namespace.',
};

export const generateJsonSchemas = (): Record<
  GeneratedSchemaName,
  JsonSchema
> =>
  Object.fromEntries(
    Object.entries(schemas).map(([name, schema]) => {
      let structural = closeTupleLengths(
        z.toJSONSchema(schema, { unrepresentable: 'any' })
      ) as JsonSchema;
      if (name === 'annotations-file') {
        structural = reserveAnnotationsRecordKey(structural);
      }
      const $comment = SEMANTIC_PASS_COMMENTS[name as GeneratedSchemaName];
      return [name, $comment ? { $comment, ...structural } : structural];
    })
  ) as Record<GeneratedSchemaName, JsonSchema>;

export const GENERATED_SCHEMA_NAMES = Object.keys(
  schemas
) as GeneratedSchemaName[];
