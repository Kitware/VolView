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
// JSON Schema is deliberately NOT the wire contract: it describes validity
// but not rendering, and there is exactly one producer (our backend) and one
// consumer (our renderer).
//
// House rules: functional style; `type`, not `interface`. Additive-only —
// new fields (guidance / interactive semantics, future extensions) must
// extend this schema AGAINST `specVersion`, never mutate it.
// ---------------------------------------------------------------------------

import { z } from 'zod';

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

// Axis-aligned world-space box in LPS: [xmin, xmax, ymin, ymax, zmin, zmax].
// The value carried by a `bounds` parameter (bound from the crop tool; maps
// from Slicer XML `<region>`).
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
// unknown kind fails validation (the negative fixture exercises this). The
// engine reuses the per-kind pieces to hide an unknown param and refuse
// submit if it was required — a graceful per-param fail-closed, NOT a
// whole-spec reject.
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
// is an optional renderer override with no Slicer-XML source — the renderer
// picks a default widget from `kind` when it is absent.
const paramCommon = {
  id: z.string(),
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

// Enum options are string OR number: Slicer integer/float enumerations emit
// numeric members (`<integer-enumeration>` etc.), and coercing them to strings
// at the boundary would lose the type the CLI expects back at submit.
const enumOptionSchema = z.union([z.string(), z.number()]);

const enumParam = z.object({
  kind: z.literal('enum'),
  ...paramCommon,
  options: z.array(enumOptionSchema).min(1),
  default: enumOptionSchema.optional(),
});

// Imaging-native field kind: the input. `accepts` is a list of the open
// type tags this input binds (absent/`scalar` `<image>` → `["image"]`,
// `<image type="label">` → `["labelmap"]`; the backend authors the mapping).
const sourceRefParam = z.object({
  kind: z.literal('sourceRef'),
  ...paramCommon,
  accepts: z.array(typeTagSchema).min(1),
});

// Imaging-native field kind: an axis-aligned world-space box (LPS).
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

// Cross-field constraint checks layered on top of the discriminated union.
// These are the constraints the negative "constraint-violation" fixture
// exercises. JSON Schema cannot express them; they are the zod side's extra
// rigor over the structural JSON-Schema view generated for the backend.
export const taskParameterSchema = parameterUnion
  .refine(
    (p) =>
      !(
        isNumericKind(p.kind) &&
        'min' in p &&
        'max' in p &&
        p.min != null &&
        p.max != null &&
        p.min > p.max
      ),
    { message: 'min must be <= max', path: ['min'] }
  )
  .refine(
    (p) =>
      !(
        isNumericKind(p.kind) &&
        'default' in p &&
        'min' in p &&
        p.default != null &&
        p.min != null &&
        p.default < p.min
      ),
    { message: 'default must be >= min', path: ['default'] }
  )
  .refine(
    (p) =>
      !(
        isNumericKind(p.kind) &&
        'default' in p &&
        'max' in p &&
        p.default != null &&
        p.max != null &&
        p.default > p.max
      ),
    { message: 'default must be <= max', path: ['default'] }
  )
  .refine(
    (p) =>
      !(isNumericKind(p.kind) && 'step' in p && p.step != null && p.step <= 0),
    { message: 'step must be > 0', path: ['step'] }
  )
  .refine(
    (p) =>
      !(
        p.kind === 'enum' &&
        p.default != null &&
        !p.options.includes(p.default)
      ),
    { message: 'default must be one of the enum options', path: ['default'] }
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
  id: z.string(),
  title: z.string().optional(),
  help: z.string().optional(),
  type: typeTagSchema.optional(),
  format: z.string().optional(),
});

export type VolViewTaskOutput = z.infer<typeof taskOutputSchema>;

// ---------------------------------------------------------------------------
// The task spec
// ---------------------------------------------------------------------------

export const taskSpecSchema = z.object({
  specVersion: z.number().int(),
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  parameters: z.array(taskParameterSchema),
  outputs: z.array(taskOutputSchema),
});

export type VolViewTaskSpec = z.infer<typeof taskSpecSchema>;
