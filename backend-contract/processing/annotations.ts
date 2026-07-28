// Vector annotations staged into a task or returned as a result. Coordinates
// are world LPS millimeters. Tool records exclude session identity and state;
// labels are namespaced by tool kind because the client stores are independent.
// Unknown envelope fields survive round-trip without gaining behavior.

import { z } from 'zod';

// The integer file version. Bump only on a shape change; new optional fields
// do not need it.
export const ANNOTATIONS_FILE_SCHEMA_VERSION = 1;

// World millimeters, LPS. The only space this format speaks.
export const ANNOTATIONS_SPACE = 'LPS' as const;

// The file-name extension a task spec and a backend both match these bytes on.
export const ANNOTATIONS_FILE_EXTENSION = '.annotations.json';

// The three tool kinds, and the key set of both `tools` and `labels`.
export const ANNOTATION_TOOL_KINDS = [
  'rulers',
  'rectangles',
  'polygons',
] as const;
export type AnnotationToolKind = (typeof ANNOTATION_TOOL_KINDS)[number];

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

// Finite: JSON cannot carry NaN, and an Infinity coordinate cannot be placed.
const finiteNumber = z.number().finite();
const vector3Schema = z.tuple([finiteNumber, finiteNumber, finiteNumber]);
// `__proto__` is not a portable record key: Zod/object construction can treat
// it differently from JSON Schema and Python dictionaries. Reserve it rather
// than let one validator silently drop a label or metadata entry.
export const ANNOTATIONS_RESERVED_RECORD_KEY = '__proto__';
const wireRecordKeySchema = z.string();

// The 2D plane an annotation is drawn on, in world LPS mm. `planeNormal` must
// be nonzero, but its magnitude carries no information: consumers normalize it
// before placement. A consumer resolves the plane against the referenced
// image's own metadata; a producer that cannot author a plane should echo the
// frame of an input annotation.
export const annotationFrameOfReferenceSchema = z.strictObject({
  planeNormal: vector3Schema,
  planeOrigin: vector3Schema,
});
export type AnnotationFrameOfReference = z.infer<
  typeof annotationFrameOfReferenceSchema
>;

// Fields every tool kind carries. `frameOfReference` is the required locator.
// `slice`/`frame` are ADVISORY echoes of where the producer saw the annotation:
// a consumer re-derives the slice from `frameOfReference` against its own image
// and must never trust these to place a tool.
const toolCore = {
  frameOfReference: annotationFrameOfReferenceSchema,
  slice: finiteNumber.optional(),
  // A frame indexes a cine loop, so only a non-negative integer can ever be
  // honored; anything else would render the tool unreachable.
  frame: z.number().int().nonnegative().optional(),
  labelName: z.string().optional(),
  name: z.string().optional(),
  metadata: z.record(wireRecordKeySchema, z.string()).optional(),
};

// Session identity, placement state, provenance, and inline style are rejected.
export const wireRulerSchema = z.strictObject({
  firstPoint: vector3Schema,
  secondPoint: vector3Schema,
  ...toolCore,
});
export type WireRuler = z.infer<typeof wireRulerSchema>;

// Rectangle points are opposite corners; edges follow the referenced image's
// in-plane axes. Use a polygon for a rotated box.
export const wireRectangleSchema = wireRulerSchema;
export type WireRectangle = z.infer<typeof wireRectangleSchema>;

export const wirePolygonSchema = z.strictObject({
  points: z.array(vector3Schema).min(3),
  ...toolCore,
});
export type WirePolygon = z.infer<typeof wirePolygonSchema>;

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

// A label's style. Every field is optional: a label may exist purely as a name.
export const annotationLabelSchema = z.strictObject({
  color: z.string().optional(),
  strokeWidth: z.number().optional(),
  fillColor: z.string().optional(),
});
export type AnnotationLabel = z.infer<typeof annotationLabelSchema>;

// One label namespace per tool kind, each keyed by `labelName` — cross-boundary
// label identity is the NAME, never an id.
const labelsByKindSchema = z.strictObject({
  rulers: z.record(wireRecordKeySchema, annotationLabelSchema).optional(),
  rectangles: z.record(wireRecordKeySchema, annotationLabelSchema).optional(),
  polygons: z.record(wireRecordKeySchema, annotationLabelSchema).optional(),
});
export type AnnotationLabelsByKind = z.infer<typeof labelsByKindSchema>;

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

export const annotationsFileStructuralSchema = z
  .object({
    schemaVersion: z.literal(ANNOTATIONS_FILE_SCHEMA_VERSION),
    space: z.literal(ANNOTATIONS_SPACE),
    labels: labelsByKindSchema.optional(),
    tools: z.object({
      rulers: z.array(wireRulerSchema).optional(),
      rectangles: z.array(wireRectangleSchema).optional(),
      polygons: z.array(wirePolygonSchema).optional(),
    }),
  })
  .passthrough();

export type AnnotationsSemanticIssue = {
  message: string;
  path: (string | number)[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

const hasReservedRecordKey = (value: unknown): boolean =>
  isRecord(value) &&
  Object.prototype.hasOwnProperty.call(value, ANNOTATIONS_RESERVED_RECORD_KEY);

const validateReservedRecordKeys = (
  file: unknown
): AnnotationsSemanticIssue[] => {
  if (!isRecord(file)) return [];
  const issues: AnnotationsSemanticIssue[] = [];
  const { labels, tools } = file;
  if (isRecord(labels)) {
    ANNOTATION_TOOL_KINDS.forEach((kind) => {
      if (hasReservedRecordKey(labels[kind])) {
        issues.push({
          message: `${ANNOTATIONS_RESERVED_RECORD_KEY} is a reserved label name`,
          path: ['labels', kind, ANNOTATIONS_RESERVED_RECORD_KEY],
        });
      }
    });
  }

  if (isRecord(tools)) {
    ANNOTATION_TOOL_KINDS.forEach((kind) => {
      const entries = tools[kind];
      if (!Array.isArray(entries)) return;
      entries.forEach((entry, index) => {
        if (isRecord(entry) && hasReservedRecordKey(entry.metadata)) {
          issues.push({
            message: `${ANNOTATIONS_RESERVED_RECORD_KEY} is a reserved metadata key`,
            path: [
              'tools',
              kind,
              index,
              'metadata',
              ANNOTATIONS_RESERVED_RECORD_KEY,
            ],
          });
        }
      });
    });
  }
  return issues;
};

// JSON Schema cannot express "this string key exists in that sibling map", so
// label-reference integrity is a semantic pass a backend MUST run after
// structural validation — the same two-pass shape as the task spec. The
// normative zod schema below calls this same implementation, so the two
// validation paths cannot drift.
export const validateAnnotationsFileSemantics = (
  file: unknown
): AnnotationsSemanticIssue[] => {
  const issues = validateReservedRecordKeys(file);
  if (!isRecord(file) || !isRecord(file.tools)) return issues;
  const tools = file.tools;
  const labels = isRecord(file.labels) ? file.labels : {};

  ANNOTATION_TOOL_KINDS.forEach((kind) => {
    const entries = (tools as Record<string, unknown>)[kind];
    if (!Array.isArray(entries)) return;
    const namespace = labels[kind];
    entries.forEach((entry, index) => {
      if (!isRecord(entry)) return;
      const { frameOfReference, labelName } = entry;
      const planeNormal = isRecord(frameOfReference)
        ? frameOfReference.planeNormal
        : undefined;
      if (
        Array.isArray(planeNormal) &&
        planeNormal.length === 3 &&
        planeNormal.every(
          (component) => typeof component === 'number' && component === 0
        )
      ) {
        issues.push({
          message: 'planeNormal must be a nonzero vector',
          path: ['tools', kind, index, 'frameOfReference', 'planeNormal'],
        });
      }
      if (typeof labelName !== 'string' || labelName === '') return;
      const declared =
        isRecord(namespace) &&
        Object.prototype.hasOwnProperty.call(namespace, labelName);
      if (declared) return;
      issues.push({
        message: `labelName ${labelName} is not declared in labels.${kind}`,
        path: ['tools', kind, index, 'labelName'],
      });
    });
  });
  return issues;
};

const annotationsFileSchemaAfterStructural =
  annotationsFileStructuralSchema.superRefine((file, ctx) => {
    validateAnnotationsFileSemantics(file).forEach((issue) =>
      ctx.addIssue({ code: 'custom', ...issue })
    );
  });

// Zod materializes records before `superRefine`, and `__proto__` can disappear
// during that construction. Inspect this one reserved key on the raw input;
// all other semantic checks run after structural parsing as usual.
export const annotationsFileSchema = z.preprocess((file, ctx) => {
  validateReservedRecordKeys(file).forEach((issue) =>
    ctx.addIssue({ code: 'custom', input: file, ...issue })
  );
  return file;
}, annotationsFileSchemaAfterStructural);

export type AnnotationsFile = z.infer<typeof annotationsFileSchema>;
