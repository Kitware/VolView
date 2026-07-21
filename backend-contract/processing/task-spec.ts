// ---------------------------------------------------------------------------
// VolView task-spec schema — the neutral task description.
//
// This is VolView's OWN, zod-validated task description. A backend never speaks
// this shape natively: a server-side backend TRANSLATES its native task format
// (Slicer Execution Model XML, MONAI `/info`, …) into this one neutral spec.
// The zod source here is the single normative definition; the golden JSON
// fixtures under `fixtures/` are the interchange format both the client (zod)
// and the backend (a JSON-Schema generated from this source) validate against.
//
// Additive-only: new fields must extend this schema AGAINST `specVersion`,
// never mutate it.
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { pathSegmentIdSchema } from './ids';

// The integer spec version, present from day one so later additions are
// negotiable. Bump only on a shape change; new optional fields do not need it.
export const SPEC_VERSION = 1;

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

// Semantic type tag. OPEN vocabulary (no closed server enum): the
// tag says what an input/output IS to the task, not its byte format. Unknown
// tags are ACCEPTED, never rejected — a `z.string()`, not a `z.enum`. v1 seed
// vocabulary is `image | labelmap`; modality refinements (`ct`, `pet`) extend
// it when a task needs them.
export const TYPE_TAG_IMAGE = 'image';
export const TYPE_TAG_LABELMAP = 'labelmap';
export const typeTagSchema = z.string();
const identifierSchema = z.string().regex(/\S/, 'id must not be empty');

// Axis-aligned world-space box in LPS: [xmin, xmax, ymin, ymax, zmin, zmax].
// The value carried by a `bounds` parameter (bound from the crop tool).
export const boundsSchema = z.tuple([
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
]);
export type Bounds = z.infer<typeof boundsSchema>;

// The known parameter kinds. An unknown kind is DETECTABLE: the whole-spec
// schema below is a discriminated union over `kind`, so a spec carrying an
// unknown kind fails validation. The engine reuses the per-kind pieces to hide
// an unknown param and refuse submit if it was required — a graceful per-param
// fail-closed, NOT a whole-spec reject.
export const PARAMETER_KINDS = [
  'int',
  'float',
  'string',
  'bool',
  'enum',
  'sourceRef',
  'bounds',
] as const;
export type ParameterKind = (typeof PARAMETER_KINDS)[number];

// ---------------------------------------------------------------------------
// Parameter kinds
// ---------------------------------------------------------------------------

// Fields common to every parameter kind: identity, the advisory UI hints
// (`section` / `order` / `help` / `widget`), and the `required` flag. `widget`
// is an optional renderer override — the renderer picks a default widget from
// `kind` when it is absent.
const paramCommon = {
  id: identifierSchema,
  title: z.string().optional(),
  help: z.string().optional(),
  section: z.string().optional(),
  order: z.number().optional(),
  widget: z.string().optional(),
  required: z.boolean().optional(),
};

const intParam = z.object({
  kind: z.literal('int'),
  ...paramCommon,
  min: z.number().int().optional(),
  max: z.number().int().optional(),
  step: z.number().int().optional(),
  default: z.number().int().optional(),
});

const floatParam = z.object({
  kind: z.literal('float'),
  ...paramCommon,
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  default: z.number().optional(),
});

const stringParam = z.object({
  kind: z.literal('string'),
  ...paramCommon,
  default: z.string().optional(),
});

const boolParam = z.object({
  kind: z.literal('bool'),
  ...paramCommon,
  default: z.boolean().optional(),
});

// Enum options are string OR number: some backend task formats declare numeric
// enumerations (e.g. Slicer integer/float enumerations), and coercing them to
// strings at the boundary would lose the type the task expects back at submit.
const enumOptionSchema = z.union([z.string(), z.number()]);

const enumParam = z.object({
  kind: z.literal('enum'),
  ...paramCommon,
  options: z.array(enumOptionSchema).min(1),
  default: enumOptionSchema.optional(),
});

// Imaging-native field kind: the input. `accepts` is a list of the open type
// tags this input binds (e.g. `["image"]`, `["labelmap"]`); the backend authors
// the mapping from its native format.
const sourceRefParam = z.object({
  kind: z.literal('sourceRef'),
  ...paramCommon,
  accepts: z.array(typeTagSchema).min(1),
});

const boundsParam = z.object({
  kind: z.literal('bounds'),
  ...paramCommon,
  default: boundsSchema.optional(),
});

const parameterUnion = z.discriminatedUnion('kind', [
  intParam,
  floatParam,
  stringParam,
  boolParam,
  enumParam,
  sourceRefParam,
  boundsParam,
]);

const isNumericKind = (kind: ParameterKind) =>
  kind === 'int' || kind === 'float';

export type TaskSpecSemanticIssue = {
  message: string;
  path: (string | number)[];
};

type StructuralTaskParameter = z.infer<typeof parameterUnion>;

const parameterSemanticIssues = (
  p: StructuralTaskParameter
): TaskSpecSemanticIssue[] => {
  const issues: TaskSpecSemanticIssue[] = [];
  if (
    isNumericKind(p.kind) &&
    'min' in p &&
    'max' in p &&
    p.min != null &&
    p.max != null &&
    p.min > p.max
  ) {
    issues.push({ message: 'min must be <= max', path: ['min'] });
  }
  if (
    isNumericKind(p.kind) &&
    'default' in p &&
    'min' in p &&
    p.default != null &&
    p.min != null &&
    p.default < p.min
  ) {
    issues.push({ message: 'default must be >= min', path: ['default'] });
  }
  if (
    isNumericKind(p.kind) &&
    'default' in p &&
    'max' in p &&
    p.default != null &&
    p.max != null &&
    p.default > p.max
  ) {
    issues.push({ message: 'default must be <= max', path: ['default'] });
  }
  if (isNumericKind(p.kind) && 'step' in p && p.step != null && p.step <= 0) {
    issues.push({ message: 'step must be > 0', path: ['step'] });
  }
  if (
    p.kind === 'enum' &&
    p.default != null &&
    !p.options.includes(p.default)
  ) {
    issues.push({
      message: 'default must be one of the enum options',
      path: ['default'],
    });
  }
  return issues;
};

// JSON Schema cannot compare sibling values such as `default` and `max`.
// Backends must run this semantic pass after structural JSON-Schema validation.
// The normative zod schema below calls the same implementation, preventing the
// two validation paths from drifting.
export const validateTaskSpecSemantics = (
  spec: unknown
): TaskSpecSemanticIssue[] => {
  if (spec === null || typeof spec !== 'object') return [];
  const record = spec as Record<string, unknown>;
  const issues: TaskSpecSemanticIssue[] = [];

  if (Array.isArray(record.parameters)) {
    record.parameters.forEach((parameter, index) => {
      const parsed = parameterUnion.safeParse(parameter);
      if (!parsed.success) return;
      parameterSemanticIssues(parsed.data).forEach((issue) =>
        issues.push({ ...issue, path: ['parameters', index, ...issue.path] })
      );
    });
  }

  (['parameters', 'outputs'] as const).forEach((field) => {
    const entries = record[field];
    if (!Array.isArray(entries)) return;
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      if (
        entry === null ||
        typeof entry !== 'object' ||
        !('id' in entry) ||
        typeof entry.id !== 'string'
      ) {
        return;
      }
      if (seen.has(entry.id)) {
        issues.push({
          message: `duplicate ${field === 'parameters' ? 'parameter' : 'output'} id: ${entry.id}`,
          path: [field, index, 'id'],
        });
      }
      seen.add(entry.id);
    });
  });

  return issues;
};

// Cross-field constraint checks layered on top of the discriminated union.
export const taskParameterSchema = parameterUnion.superRefine(
  (parameter, ctx) => {
    parameterSemanticIssues(parameter).forEach((issue) =>
      ctx.addIssue({ code: 'custom', ...issue })
    );
  }
);

export type VolViewTaskParameter = z.infer<typeof taskParameterSchema>;

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

// A declared task output. `type` is the same open semantic tag as inputs
// (`image | labelmap | file | …`); `format` is an advisory byte-format hint
// (e.g. `.nii.gz`). The backend authors these; the client maps them to result
// intents.
export const taskOutputSchema = z.object({
  id: identifierSchema,
  title: z.string().optional(),
  help: z.string().optional(),
  type: typeTagSchema.optional(),
  format: z.string().optional(),
});

export type VolViewTaskOutput = z.infer<typeof taskOutputSchema>;

// ---------------------------------------------------------------------------
// The task spec
// ---------------------------------------------------------------------------

const reportDuplicateIds = (
  entries: unknown[],
  path: 'parameters' | 'outputs',
  ctx: z.RefinementCtx
) => {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('id' in entry) ||
      typeof entry.id !== 'string'
    ) {
      return;
    }
    const { id } = entry;
    if (!seen.has(id)) {
      seen.add(id);
      return;
    }
    ctx.addIssue({
      code: 'custom',
      message: `duplicate ${path === 'parameters' ? 'parameter' : 'output'} id: ${id}`,
      path: [path, index, 'id'],
    });
  });
};

export const taskSpecStructuralSchema = z.object({
  specVersion: z.number().int(),
  id: pathSegmentIdSchema.regex(/\S/, 'id must not be empty'),
  title: z.string(),
  description: z.string().optional(),
  parameters: z.array(taskParameterSchema),
  outputs: z.array(taskOutputSchema),
});

export const reportDuplicateTaskSpecIds = (
  spec: { parameters: unknown[]; outputs: unknown[] },
  ctx: z.RefinementCtx
) => {
  reportDuplicateIds(spec.parameters, 'parameters', ctx);
  reportDuplicateIds(spec.outputs, 'outputs', ctx);
};

export const taskSpecSchema = taskSpecStructuralSchema.superRefine(
  reportDuplicateTaskSpecIds
);

export type VolViewTaskSpec = z.infer<typeof taskSpecSchema>;
