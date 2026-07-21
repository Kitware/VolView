// ---------------------------------------------------------------------------
// The neutral client<->backend REST surface, as an OpenAPI 3.1 document.
// This is the SERVER-side dual of the client transport (engine/transport.ts):
// one states the neutral surface for backend authors, the other implements the
// client half of it.
//
// NEUTRALITY INVARIANT (the whole point): this describes ONLY the neutral
// surface — no Girder routes, no `folderId`, no file ids, no `JobStatus` enum,
// no proxiable-URL shape, no Slicer XML. A reviewer can enumerate exactly what a
// non-Girder backend must implement WITHOUT reading girder_volview source. The
// `__tests__/openapi.spec.ts` neutrality gate greps this document for those
// leaks; keep it clean.
//
// SINGLE SOURCE: the wire component schemas are the SAME zod-generated JSON
// Schemas the backend validates against (`schema-json.ts` / `generateJsonSchemas`),
// injected here rather than re-typed — so the OpenAPI can never drift from the
// normative zod definition. The hand-authored pieces are only the request/
// response ENVELOPES the client wraps the wire schemas in (they have no zod home
// — they are the engine's transport, not the contract vocabulary).
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { generateJsonSchemas, type GeneratedSchemaName } from './schema-json';
import { INTENT_VOCABULARY_VERSION } from './wire';
import { SPEC_VERSION } from './task-spec';
import { pathSegmentIdSchema } from './ids';

// ---------------------------------------------------------------------------
// Wire component schemas — injected from the single zod source
// ---------------------------------------------------------------------------

// Generated-schema name -> OpenAPI component name. Every neutral wire schema the
// package defines is published as a component so a backend author sees the whole
// vocabulary in one document.
const WIRE_COMPONENTS: Record<GeneratedSchemaName, string> = {
  'task-spec': 'TaskSpec',
  'input-value': 'InputValue',
  'stage-input-descriptor': 'StageInputDescriptor',
  'neutral-job-status': 'NeutralJobStatus',
  'result-intent': 'ResultIntent',
  'job-history-summary': 'JobHistorySummary',
  'job-history-page': 'JobHistoryPage',
  'job-history-detail': 'JobHistoryDetail',
  'job-results': 'JobResults',
  'job-results-error': 'JobResultsError',
};

// The generated schemas carry a per-schema `$schema` dialect marker; OpenAPI 3.1
// declares the dialect once at the document root (`jsonSchemaDialect`), so strip
// the per-schema marker as each is embedded as a component.
const stripDialect = (schema: unknown): Record<string, unknown> => {
  const { $schema, ...rest } = schema as Record<string, unknown>;
  void $schema;
  return rest;
};

const pathSegmentIdJsonSchema = () =>
  stripDialect(z.toJSONSchema(pathSegmentIdSchema));

const wireComponentSchemas = (): Record<string, unknown> => {
  const generated = generateJsonSchemas();
  return dedupeNestedComponents(
    Object.fromEntries(
      (Object.keys(WIRE_COMPONENTS) as GeneratedSchemaName[]).map((name) => [
        WIRE_COMPONENTS[name],
        stripDialect(generated[name]),
      ])
    )
  );
};

// The zod->JSON-Schema generation runs per schema, so a wire schema nested
// inside another is emitted as a full inline copy of a component that is ALSO
// published standalone. Replace those known copies with a $ref to the component
// — smaller and unambiguous for a reader ("intents is an array of
// ResultIntent"). Guarded: the inline copy must be byte-identical to the
// component it is replaced by, so the substitution can never change meaning.
const NESTED_COMPONENT_COPIES = [
  { host: 'JobResults', property: 'intents', component: 'ResultIntent' },
  { host: 'JobHistoryPage', property: 'jobs', component: 'JobHistorySummary' },
] as const;

const dedupeNestedComponents = (
  schemas: Record<string, unknown>
): Record<string, unknown> => {
  NESTED_COMPONENT_COPIES.forEach(({ host, property, component }) => {
    const hostSchema = schemas[host] as {
      properties: Record<string, { items: unknown }>;
    };
    const inline = hostSchema.properties[property].items;
    if (JSON.stringify(inline) !== JSON.stringify(schemas[component])) {
      throw new Error(
        `openapi dedupe: ${host}.${property}.items no longer matches the ` +
          `${component} component; update NESTED_COMPONENT_COPIES`
      );
    }
    hostSchema.properties[property].items = ref(component);
  });
  return schemas;
};

// ---------------------------------------------------------------------------
// Envelope component schemas — hand-authored transport shapes (no zod home)
//
// These are the request/response wrappers the client puts the wire schemas in.
// They are NOT the contract vocabulary (that is the zod-generated set above);
// they are the neutral transport envelope, kept small and free of any backend
// specific.
// ---------------------------------------------------------------------------

const ref = (component: string) => ({
  $ref: `#/components/schemas/${component}`,
});

const envelopeComponentSchemas = (): Record<string, unknown> => ({
  TaskSummary: {
    type: 'object',
    description:
      'Advisory display metadata for one task in the picker. Pass-through: the ' +
      'client renders it but validates only id/title; every other field is ' +
      'OPTIONAL advisory display metadata a backend MAY omit, and the client ' +
      'never dispatches on it.',
    properties: {
      id: pathSegmentIdJsonSchema(),
      title: { type: 'string' },
      description: { type: 'string' },
      category: { type: 'array', items: { type: 'string' } },
    },
    required: ['id', 'title'],
    additionalProperties: true,
  },

  RunTaskRequest: {
    type: 'object',
    description:
      'Submission payload. `values` maps each task parameter id to its bound ' +
      'value: an InputValue for an input binding, or a scalar/list for a ' +
      'plain parameter.',
    properties: {
      values: {
        type: 'object',
        additionalProperties: {
          oneOf: [
            ref('InputValue'),
            { type: 'string' },
            { type: 'number' },
            { type: 'boolean' },
            { type: 'array' },
            { type: 'null' },
          ],
        },
      },
    },
    required: ['values'],
    additionalProperties: false,
  },

  JobRef: {
    type: 'object',
    description:
      'Handle to the submitted job. `jobId` is opaque. An optional terminal ' +
      '`status` is the born-terminal fast-path for a synchronous backend.',
    properties: {
      jobId: pathSegmentIdJsonSchema(),
      status: ref('NeutralJobStatus'),
    },
    required: ['jobId'],
    additionalProperties: false,
  },

  StageResponse: {
    type: 'object',
    description:
      'Backend-minted opaque URIs for the staged bytes. The client mints no URI ' +
      'itself, so at least one is required (fail closed).',
    properties: {
      uris: { type: 'array', items: { type: 'string' }, minItems: 1 },
    },
    required: ['uris'],
    additionalProperties: false,
  },
});

// ---------------------------------------------------------------------------
// Reusable response fragments
// ---------------------------------------------------------------------------

const json = (schema: Record<string, unknown>) => ({
  'application/json': { schema },
});

// A result read before readiness, or after an execution failure, is a typed
// conflict. Settled partial and total output loss are successful reads carrying
// `resultState: incomplete` and an accurate missing count.
const resultReadErrorResponse = {
  description:
    'Results are still waiting, or execution made them unavailable. ' +
    'The typed body distinguishes retryable readiness from permanent unavailability.',
  content: json(ref('JobResultsError')),
};

// ---------------------------------------------------------------------------
// Paths — every endpoint the client actually calls, in neutral terms
//
// Two addressing models, both neutral:
//   * context-scoped   (tag `context`): relative to a processing context — the
//     collection a task runs against. tasks / spec / run / stage / recent-jobs.
//   * job-addressed    (tag `job`): keyed by the opaque job id ALONE; the job's
//     own access control is the gate, so no context appears in the path.
// ---------------------------------------------------------------------------

const taskIdParam = {
  name: 'taskId',
  in: 'path',
  required: true,
  description: 'Opaque task identifier.',
  schema: pathSegmentIdJsonSchema(),
} as const;

const jobIdParam = {
  name: 'jobId',
  in: 'path',
  required: true,
  description: 'Opaque job identifier.',
  schema: pathSegmentIdJsonSchema(),
} as const;

const paths = (): Record<string, unknown> => ({
  '/tasks': {
    get: {
      operationId: 'listTasks',
      tags: ['context'],
      summary: 'List the processing tasks available in this context.',
      responses: {
        '200': {
          description: 'The available tasks as advisory summaries.',
          content: json({ type: 'array', items: ref('TaskSummary') }),
        },
      },
    },
  },

  '/tasks/{taskId}/spec': {
    get: {
      operationId: 'getTaskSpec',
      tags: ['context'],
      summary:
        "Get a task's VolView task spec (the backend translates its own " +
        'native task format into this neutral spec).',
      parameters: [taskIdParam],
      responses: {
        '200': {
          description: "The task's neutral task spec.",
          content: json(ref('TaskSpec')),
        },
        '404': { description: 'No such task in this context.' },
      },
    },
  },

  '/tasks/{taskId}/run': {
    post: {
      operationId: 'runTask',
      tags: ['context'],
      summary: 'Submit a task; returns an opaque job handle to poll.',
      parameters: [taskIdParam],
      requestBody: {
        required: true,
        content: json(ref('RunTaskRequest')),
      },
      responses: {
        '200': {
          description: 'The submitted job handle.',
          content: json(ref('JobRef')),
        },
        '404': { description: 'No such task in this context.' },
      },
    },
  },

  '/jobs': {
    get: {
      operationId: 'listJobHistory',
      tags: ['context'],
      summary: "The current user's complete job history, newest first.",
      parameters: [
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 100 },
        },
        {
          name: 'cursor',
          in: 'query',
          description: 'Opaque continuation cursor returned by the prior page.',
          schema: { type: 'string' },
        },
      ],
      responses: {
        '200': {
          description:
            'One bounded lightweight page; logs and parameters are absent.',
          content: json(ref('JobHistoryPage')),
        },
      },
    },
  },

  '/jobs/{jobId}/detail': {
    get: {
      operationId: 'getJobHistoryDetail',
      tags: ['job'],
      summary:
        'Read logs and submitted parameters for one authorized job on demand.',
      parameters: [jobIdParam],
      responses: {
        '200': {
          description: 'The detail-only job fields.',
          content: json(ref('JobHistoryDetail')),
        },
      },
    },
  },

  '/stage': {
    post: {
      operationId: 'stageInput',
      tags: ['context'],
      summary:
        'Stage a parent-bound labelmap as a transient input; returns ' +
        'backend-minted URIs the client round-trips as an InputValue at submit.',
      requestBody: {
        required: true,
        description:
          'A typed staged resource: the labelmap bytes plus its durable ' +
          'reference-image relationship.',
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              properties: {
                file: { type: 'string', format: 'binary' },
                descriptor: ref('StageInputDescriptor'),
              },
              required: ['file', 'descriptor'],
              additionalProperties: false,
            },
            encoding: {
              descriptor: {
                contentType: 'text/plain',
                description: 'JSON serialization of StageInputDescriptor.',
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'The backend-minted URIs for the staged bytes.',
          content: json(ref('StageResponse')),
        },
      },
    },
  },

  '/jobs/{jobId}': {
    get: {
      operationId: 'getJob',
      tags: ['job'],
      summary:
        "A job's neutral execution and result-readiness status. Poll until " +
        'the job reaches a terminal state. Job-addressed: keyed by the opaque ' +
        "job id alone and gated by the job's own access control — no context " +
        'in the path.',
      parameters: [jobIdParam],
      responses: {
        '200': {
          description: 'The neutral job status.',
          content: json(ref('NeutralJobStatus')),
        },
      },
    },
    delete: {
      operationId: 'deleteJob',
      tags: ['job'],
      summary:
        'Delete one authorized terminal execution record AND everything it ' +
        'owns (cascading).',
      description:
        'Deletion is CASCADING, and the cascade is normative: removing the ' +
        'execution record also removes the results it produced and any staged ' +
        'inputs it still owns. A conforming backend MUST NOT retain results ' +
        'for a deleted record, so a client may truthfully tell the user that ' +
        'deleting the job deletes its results. Only a terminal (success / ' +
        'error / cancelled) job is deletable; a non-terminal job is refused ' +
        'with 409 — cancel it and delete once it settles.',
      parameters: [jobIdParam],
      responses: {
        '204': {
          description:
            'The job and everything it owned (results, staged inputs) were ' +
            'deleted.',
        },
        '409': {
          description:
            'The job is not terminal; cancel it and re-delete once it settles.',
        },
      },
    },
  },

  '/jobs/{jobId}/results': {
    get: {
      operationId: 'getJobResults',
      tags: ['job'],
      summary:
        "A job's settled results as the { resultState, intents, missing } " +
        'envelope. Partial and total output loss return an incomplete envelope.',
      parameters: [jobIdParam],
      responses: {
        '200': {
          description:
            'The resolved results as the { resultState, intents, missing } envelope ' +
            '(JobResults). Each entry of `intents` is a ResultIntent — a result ' +
            'row carrying a required `id` display key and required `name`/`url`, ' +
            'plus optional/null `mimeType`/`size` file metadata. `missing` counts ' +
            'declared outputs that never arrived plus recorded outputs that cannot ' +
            'be read. Total loss is a valid incomplete response with an empty ' +
            'intents array.',
          content: json(ref('JobResults')),
        },
        '409': resultReadErrorResponse,
      },
    },
  },

  '/jobs/{jobId}/cancel': {
    post: {
      operationId: 'cancelJob',
      tags: ['job'],
      summary:
        "Best-effort cancel. Returns the job's real projected status after the " +
        'attempt — never a fabricated `cancelled`; the client poller converges ' +
        'on whatever terminal state the backend ultimately reports. Job-addressed.',
      parameters: [jobIdParam],
      responses: {
        '200': {
          description: 'The projected job status after the cancel attempt.',
          content: json(ref('NeutralJobStatus')),
        },
      },
    },
  },
});

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export const buildOpenApiDocument = (): Record<string, unknown> => ({
  openapi: '3.1.0',
  jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
  info: {
    title: 'VolView neutral backend contract',
    // The ARTIFACT's own draft version: a private draft 0.x carrying no
    // stability promise, DISTINCT from the shape versions (INTENT_VOCABULARY_
    // VERSION / specVersion) below. It is deliberately literal, not derived from
    // the shape-version constants — the artifact and the shapes version on
    // separate clocks.
    version: '0.1.0',
    description:
      'DRAFT 0.x — shapes may change until a second backend passes the ' +
      'conformance kit (the pinned 1.0 criterion). ' +
      'The neutral REST surface the VolView client calls to run processing ' +
      'tasks against a backend. A conforming server-side BACKEND implements ' +
      'these endpoints and the referenced wire schemas — no VolView client ' +
      'change is needed to bring a new backend online. Everything here is ' +
      'neutral: no backend routes, ids, status enums, or URL shapes leak. The ' +
      'artifact version is the draft artifact version, distinct from ' +
      'the shape versions: the result-intent vocabulary is at version ' +
      `${INTENT_VOCABULARY_VERSION} (INTENT_VOCABULARY_VERSION); the task-spec ` +
      `shape at version ${SPEC_VERSION} (specVersion).`,
  },
  servers: [
    {
      url: '{baseUrl}',
      description:
        'The provider processing base. Context-scoped endpoints are relative ' +
        'to a processing context; job-addressed endpoints are keyed by job id ' +
        'alone. The mapping of both onto concrete URLs is the backend choice.',
      variables: { baseUrl: { default: '/' } },
    },
  ],
  tags: [
    {
      name: 'context',
      description:
        'Context-scoped: operate against a processing context (the collection ' +
        'a task runs in).',
    },
    {
      name: 'job',
      description:
        'Job-addressed: keyed by the opaque job id alone and gated by the ' +
        "job's own access control — no context in the path.",
    },
  ],
  paths: { ...paths() },
  components: {
    schemas: {
      ...wireComponentSchemas(),
      ...envelopeComponentSchemas(),
    },
  },
});

// Every operationId the published surface must expose (enumerate the backend
// obligation without reading girder_volview source).
export const NEUTRAL_OPERATION_IDS = [
  'listTasks',
  'getTaskSpec',
  'runTask',
  'listJobHistory',
  'getJobHistoryDetail',
  'deleteJob',
  'stageInput',
  'getJob',
  'getJobResults',
  'cancelJob',
] as const;
