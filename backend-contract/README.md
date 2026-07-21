# backend-contract

> **Status: private draft `0.x`.** No stability promise; shapes may change any
> day. The artifact version is the OpenAPI `info.version` in
> `generated/openapi.json`, mirrored by `package.json` (a drift test keeps them
> in lockstep). Sole known consumer: girder_volview, which reads this tree from
> the installed `volview` npm package.

The neutral VolView backend contract: task discovery, inputs, the job
lifecycle, result intents, and personal job history. No backend speaks these
shapes natively; each backend translates its own task format into this spec.

To bring a new backend online, implement the [OpenAPI surface](#the-neutral-rest-surface-openapi)
and validate against the fixtures and generated schemas. Zero VolView client
change, and no need to read girder_volview source: girder_volview is a
consumer of this package, not its owner.

## Layout

```
backend-contract/
  index.ts            top-level barrel; re-exports ./processing
  processing/
    task-spec.ts      VolView's zod task-spec schema
    wire.ts           neutral wire shapes: input value, job status, job history,
                      result-intent vocabulary
    openapi.ts        the REST surface as an OpenAPI 3.1 document (wire schemas
                      injected from the zod codegen)
    schema-json.ts    zod -> JSON Schema codegen
    index.ts          re-exports schemas + types (not codegen/openapi)
    __tests__/        every fixture validates; negatives fail; generated
                      artifacts stay in sync with the zod source
  generated/          checked-in *.schema.json (one per wire schema) + openapi.json
  fixtures/
    task-spec/        synthetic golden task specs (no backend-native formats;
                      translation is a backend concern)
    negative/         payloads that MUST fail validation
    wire/             input values, job statuses, result intents, job handle,
                      result-read payloads
  scripts/
    generate-json-schema.ts   regenerates generated/*.schema.json
    generate-openapi.ts       regenerates generated/openapi.json
```

## The single normative definition

The zod sources are the one normative definition. The golden JSON fixtures are
the interchange format both sides pin, and the generated JSON Schemas are the
backend's validator, codegen'd from the zod source so the two can't drift.

Task specs require two validation passes. First validate the generated
`task-spec.schema.json`, then enforce the cross-field rules implemented by
`validateTaskSpecSemantics` (or an equivalent implementation in the backend's
language). Standard JSON Schema cannot compare sibling values such as
`default <= max`. Backend conformance tests must also assert that every payload
under `fixtures/negative/` is rejected by the combined validation path.

## The neutral REST surface (OpenAPI)

`generated/openapi.json` (built from `processing/openapi.ts`) describes exactly
the endpoints the client calls, in neutral terms: no Girder routes, ids, or
enums.

| operation             | method + path                | request → response                                                                    |
| --------------------- | ---------------------------- | ------------------------------------------------------------------------------------- |
| `listTasks`           | `GET /tasks`                 | → `TaskSummary[]`                                                                     |
| `getTaskSpec`         | `GET /tasks/{taskId}/spec`   | → `TaskSpec`                                                                          |
| `runTask`             | `POST /tasks/{taskId}/run`   | `RunTaskRequest` → `JobRef`                                                           |
| `listJobHistory`      | `GET /jobs`                  | → paged `JobHistorySummary[]` (optional)                                              |
| `getJobHistoryDetail` | `GET /jobs/{jobId}/detail`   | → logs + submitted parameters on demand                                               |
| `deleteJob`           | `DELETE /jobs/{jobId}`       | → cascading deletion: execution record, results, staged inputs (terminal jobs only; 409 otherwise) |
| `stageInput`          | `POST /stage`                | parent-bound labelmap multipart → `StageResponse` (optional)                          |
| `getJob`              | `GET /jobs/{jobId}`          | → `NeutralJobStatus`                                                                  |
| `getJobResults`       | `GET /jobs/{jobId}/results`  | → result intents, or explicit error                                                   |
| `cancelJob`           | `POST /jobs/{jobId}/cancel`  | → `NeutralJobStatus`                                                                  |

Notes:

- The lifecycle is poll-only (`getJob`); push (SSE) is an additive backend-only
  enhancement, not described here.
- Job-addressed routes are keyed by the opaque job id alone; the job's own
  access control is the gate, so no context leaks into the path.
- `JobHistorySummary.outputSummary.recorded` counts declared outputs that
  recorded and resolve to a readable file; `missing` counts the rest (never
  recorded, or no longer readable).

## Job-state names

The neutral job states are `pending | running | success | error | cancelled`,
the names the client store consumes at runtime. A backend-side conformance test
(girder_volview `tests/test_status_conformance.py`) validates the projected
status against the generated `neutral-job-status` schema.

## Versioning

Two versions on separate clocks:

- **Artifact version**: `package.json` `version` and the OpenAPI
  `info.version`, kept in lockstep by `processing/__tests__/openapi.spec.ts`.
  Versions this package as a published thing.
- **Shape versions**: `INTENT_VOCABULARY_VERSION` (`processing/wire.ts`) and
  the task-spec `specVersion`. These version the wire vocabulary for additive
  compatibility negotiation.

## Regenerating

```
npx tsx backend-contract/scripts/generate-json-schema.ts   # rewrite generated/*.schema.json
npx tsx backend-contract/scripts/generate-openapi.ts       # rewrite generated/openapi.json
```

Drift guards (`processing/__tests__/generated-schema.spec.ts`,
`processing/__tests__/openapi.spec.ts`) fail if the checked-in artifacts fall
out of sync with the zod source.

## How the backend consumes this

The `volview` npm package ships `backend-contract/` in its `files`;
girder_volview reads fixtures + generated schemas from the installed package
via its `tests/contract_loader.py`. No vendored copy, no sync step: the
exact-pinned `volview` version in girder_volview's `web_client/package.json` IS
the contract pin. For unreleased branches use `npm link` or the
`GIRDER_VOLVIEW_CONTRACT_DIR` escape hatch (see the loader's docstring).
