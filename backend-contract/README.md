# backend-contract

> **Status: private draft `0.x`.** The artifact version is the OpenAPI
> `info.version` in `generated/openapi.json`, mirrored by `package.json` and kept
> in lockstep by a drift test. This is a private, versioned draft with exactly one
> known consumer (girder_volview, vendored via `sync-backend.sh`); it carries no
> stability promise and no distribution channel. The shapes may change any day.

The neutral VolView backend contract, published as a self-contained,
backend-decoupled artifact. It defines the **processing** surface — task
discovery, inputs, the job lifecycle, result intents, and personal job history.
The VolView client and any server-side backend (girder_volview today) build
against the shapes defined here; no backend speaks them natively — a backend
**translates** its native task format into this one neutral spec.

**Bring a new backend online = implement the [OpenAPI](#the-neutral-rest-surface-openapi)
and validate against the fixtures + generated schemas; zero VolView client
change.** Adding a backend is a _conformance exercise_, not a reverse-engineering
of girder_volview: girder_volview is one _consumer_ of this package, not its
owner. It vendors the fixtures + generated schemas (`tests/contract/`) and
validates against them; it defines nothing here.

## Layout

```
backend-contract/
  index.ts            top-level barrel; re-exports ./processing
  processing/         the client↔backend processing contract
    task-spec.ts      VolView's own zod task-spec schema
    wire.ts           neutral wire shapes: input value, job status, job history,
                      and the result-intent vocabulary
    openapi.ts        the neutral REST surface as an OpenAPI 3.1 document, built
                      single-source (wire component schemas injected from the zod
                      codegen)
    schema-json.ts    zod -> JSON Schema codegen
    index.ts          re-exports the schemas + types (NOT the codegen/openapi —
                      those are imported directly by scripts + tests)
    __tests__/        vitest: every fixture validates; negatives fail; the
                      generated schema + openapi stay in sync with the zod source
  generated/          checked-in artifacts the backend validates against:
                      *.schema.json (one per wire schema) + openapi.json
  fixtures/
    task-spec/        synthetic golden task specs (all field kinds + a
                      bounds/enum/UI-hints spec) — no backend-specific source
                      format (e.g. Slicer XML) lives here; translating a native
                      task format into this neutral spec is a backend concern
    negative/         payloads that MUST fail validation (fail closed)
    wire/             input values, job statuses, result intents, job handle,
                      result-read payloads
  scripts/
    generate-json-schema.ts   regenerates generated/*.schema.json
    generate-openapi.ts       regenerates generated/openapi.json
    sync-backend.sh            vendors fixtures + generated/ into a backend repo
```

## The single normative definition

The **zod sources here are the one normative definition** of the contract.
JSON Schema is deliberately NOT the wire contract — it describes validity but not
rendering, and there is exactly one producer (our backend) and one consumer (our
renderer). The **golden JSON fixtures** are the interchange format both sides
pin, and the generated JSON Schemas are the backend's _validator_, codegen'd from
the zod source so the two can't drift.

## The neutral REST surface (OpenAPI)

`generated/openapi.json` (built from `processing/openapi.ts`) describes **exactly
the endpoints the client calls**, in **neutral terms** — no Girder routes, no
`folderId`, no file ids, no `JobStatus` enum, no proxiable-URL shape. A reviewer
can enumerate what a non-Girder backend must implement **without reading
girder_volview source**:

| operation        | method + neutral path        | request → response                    |
| ---------------- | ---------------------------- | ------------------------------------- |
| `listTasks`      | `GET /tasks`                 | → `TaskSummary[]`                     |
| `getTaskSpec`    | `GET /tasks/{taskId}/spec`   | → `TaskSpec`                          |
| `runTask`        | `POST /tasks/{taskId}/run`   | `RunTaskRequest` → `JobRef`          |
| `listJobHistory` | `GET /jobs`                  | → paged `JobHistorySummary[]` (optional) |
| `getJobHistoryDetail` | `GET /jobs/{jobId}/detail` | → logs + submitted parameters on demand |
| `deleteJob`      | `DELETE /jobs/{jobId}`       | → CASCADING deletion: the execution record, its results, and its staged inputs (terminal jobs only; 409 otherwise) |
| `stageInput`     | `POST /stage`                | parent-bound labelmap multipart → `StageResponse` (optional) |
| `getJob`         | `GET /jobs/{jobId}`          | → `NeutralJobStatus`                 |
| `getJobResults`  | `GET /jobs/{jobId}/results`  | → result intents, or explicit error  |
| `cancelJob`      | `POST /jobs/{jobId}/cancel`  | → `NeutralJobStatus`                 |

> Naming note: `listJobHistory` / `JobHistorySummary` / `deleteJob` are the
> **job-history** shapes — the user's personal job history, a processing
> concept.

The component schemas are the wire schemas above (`TaskSpec`, `InputValue`,
`StageInputDescriptor`, `NeutralJobStatus`, `ResultIntent`, `JobHistorySummary`,
…), injected from the same zod codegen, so the published surface can never drift
from the normative definition. The lifecycle is **poll-only** (`getJob`); push
(SSE) is an additive backend-only enhancement, never a neutral client
requirement, so it is not described here. Job-addressed routes (`getJob` /
`getJobResults` / `cancelJob`) are keyed by the opaque job id **alone** — the
job's own access control is the gate, so no context leaks into the path.

`JobHistorySummary.outputSummary.recorded` counts declared outputs that
recorded and resolve to a readable file. `missing` counts declared outputs with
no recorded id plus recorded outputs whose file is no longer readable.

## Job-state names

The neutral job states are `pending | running | success | error | cancelled` —
the names the backend projects and the client store consumes at runtime. Girder's
native job status maps onto these with no translation layer, so the canonical
schema is named _to_ the runtime. A backend-side status-conformance test
(girder_volview `tests/test_status_conformance.py`) validates its projected
status against the generated `neutral-job-status` schema so this can't silently
drift.

## Versioning

Two versions live here and they turn on **separate clocks**:

- The **artifact version** — `package.json` `version` (`private: true`) and the
  OpenAPI `info.version`, kept in lockstep by a drift test
  (`processing/__tests__/openapi.spec.ts`). It versions _this package as a
  published thing_: a draft `0.x` carrying no stability promise.
- The **shape versions** — `INTENT_VOCABULARY_VERSION` (`processing/wire.ts`) and
  the task-spec `specVersion`. These version the _wire vocabulary_ so a producer
  and the applier can negotiate additive compatibility; they are NOT the artifact
  version.

## Regenerating

```
npx tsx backend-contract/scripts/generate-json-schema.ts   # rewrite generated/*.schema.json
npx tsx backend-contract/scripts/generate-openapi.ts       # rewrite generated/openapi.json
backend-contract/scripts/sync-backend.sh [BACKEND_REPO]     # regen + vendor into a backend repo
```

`sync-backend.sh` is the **single writer** of a backend's vendored copy (never
hand-edit `tests/contract/`); it regenerates first, then copies, so a backend's
copy is never stale. The vitest drift guards
(`processing/__tests__/generated-schema.spec.ts`,
`processing/__tests__/openapi.spec.ts`) fail if the checked-in artifacts fall out
of sync with the zod source.
