// Pure projections between annotation stores and `*.annotations.json`.
// Encoding allowlists explicitly, keeping session-only state out of task files;
// decoding leans on the contract's strict schemas, which reject an unrecognized
// producer field rather than let it reach a store.

import type {
  AnnotationLabel,
  AnnotationToolKind,
  AnnotationsFile,
  WirePolygon,
  WireRuler,
} from '@/backend-contract';
import {
  ANNOTATIONS_FILE_SCHEMA_VERSION,
  ANNOTATIONS_SPACE,
  ANNOTATION_TOOL_KINDS,
  annotationsFileSchema,
} from '@/backend-contract';
import { cleanUndefined } from '@/src/utils';

// ---------------------------------------------------------------------------
// The store-side view
// ---------------------------------------------------------------------------

type WireVector3 = [number, number, number];

// Points arrive as vtk.js `Vector3`s, which are structurally these tuples; the
// view accepts any 3-number-indexable so callers need no casts.
type PointLike = ArrayLike<number>;

// A store label as `useLabels` holds it: keyed by label id, carrying the name
// and the style props. `fillColor` is rectangles-only.
export type AnnotationLabelView = {
  labelName?: string;
  color?: string;
  strokeWidth?: number;
  fillColor?: string;
};

type AnnotationToolCoreView = {
  frameOfReference: { planeNormal: PointLike; planeOrigin: PointLike };
  slice?: number;
  frame?: number;
  labelName?: string;
  name?: string;
  metadata?: Record<string, string>;
};

export type TwoPointToolView = AnnotationToolCoreView & {
  firstPoint: PointLike;
  secondPoint: PointLike;
};

export type PolygonToolView = AnnotationToolCoreView & {
  points: ReadonlyArray<PointLike>;
};

export type AnnotationKindView<Tool> = {
  // Finished tools on ONE image; the caller owns that filter.
  tools: ReadonlyArray<Tool>;
  // The whole store label map (keyed by label id); encode prunes it.
  labels: Record<string, AnnotationLabelView>;
};

export type AnnotationToolsView = {
  rulers: AnnotationKindView<TwoPointToolView>;
  rectangles: AnnotationKindView<TwoPointToolView>;
  polygons: AnnotationKindView<PolygonToolView>;
};

// Recover geometry omitted by the uniform annotation-store type.
export const hasTwoPoints = <T extends AnnotationToolCoreView>(
  tool: T
): tool is T & TwoPointToolView =>
  'firstPoint' in tool && 'secondPoint' in tool;

// A polygon needs three points to bound an area, so a half-placed one is not
// geometry the wire can carry. Excluded here, where the view is built, so the
// count the UI shows and the file the encoder writes agree.
export const isEncodablePolygon = <T extends AnnotationToolCoreView>(
  tool: T
): tool is T & PolygonToolView =>
  'points' in tool && Array.isArray(tool.points) && tool.points.length >= 3;

export const annotationToolsViewCount = (view: AnnotationToolsView): number =>
  ANNOTATION_TOOL_KINDS.reduce(
    (total, kind) => total + view[kind].tools.length,
    0
  );

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

const toVector3 = (point: PointLike): WireVector3 => [
  point[0],
  point[1],
  point[2],
];

// A plane normal represents a direction, so its magnitude has no wire meaning.
// Normalize at the boundary before axis matching or store insertion. The
// contract's semantic pass rejects zero; keep the guard here so this projection
// remains safe if it is ever called with a value that bypassed that pass.
const normalizePlaneNormal = (normal: PointLike): WireVector3 => {
  const magnitude = Math.hypot(normal[0], normal[1], normal[2]);
  if (magnitude === 0) {
    throw new Error('planeNormal must be a nonzero vector');
  }
  return [normal[0] / magnitude, normal[1] / magnitude, normal[2] / magnitude];
};

// `slice` and `frame` are advisory echoes only — a consumer re-derives both
// from `frameOfReference`. A negative slice is the stores' "unset" sentinel and
// would be a lie on the wire.
const encodeCore = (tool: AnnotationToolCoreView) => ({
  frameOfReference: {
    planeNormal: toVector3(tool.frameOfReference.planeNormal),
    planeOrigin: toVector3(tool.frameOfReference.planeOrigin),
  },
  ...cleanUndefined({
    slice:
      typeof tool.slice === 'number' &&
      Number.isFinite(tool.slice) &&
      tool.slice >= 0
        ? tool.slice
        : undefined,
    frame:
      typeof tool.frame === 'number' &&
      Number.isInteger(tool.frame) &&
      tool.frame >= 0
        ? tool.frame
        : undefined,
    labelName: tool.labelName ? tool.labelName : undefined,
    name: tool.name ? tool.name : undefined,
    metadata:
      tool.metadata && Object.keys(tool.metadata).length > 0
        ? { ...tool.metadata }
        : undefined,
  }),
});

const encodeTwoPointTool = (tool: TwoPointToolView) => ({
  firstPoint: toVector3(tool.firstPoint),
  secondPoint: toVector3(tool.secondPoint),
  ...encodeCore(tool),
});

// A polygon needs three points to bound an area; a half-placed one is dropped
// rather than sent as an invalid file the backend would reject wholesale.
const encodePolygonTool = (tool: PolygonToolView) => ({
  points: tool.points.map(toVector3),
  ...encodeCore(tool),
});

const encodeLabelStyle = (label: AnnotationLabelView): AnnotationLabel =>
  cleanUndefined({
    color: label.color,
    strokeWidth: label.strokeWidth,
    fillColor: label.fillColor,
  });

// Namespaces are built from the names the encoded tools actually reference, so
// label-reference integrity holds by construction: a referenced name with no
// store entry still gets a (styleless) declaration rather than dangling.
const encodeLabelNamespace = (
  labels: Record<string, AnnotationLabelView>,
  referenced: Set<string>
): Record<string, AnnotationLabel> => {
  const byName = new Map<string, AnnotationLabelView>();
  Object.values(labels).forEach((label) => {
    if (label?.labelName) byName.set(label.labelName, label);
  });
  return Object.fromEntries(
    [...referenced].map((labelName) => {
      const label = byName.get(labelName);
      return [labelName, label ? encodeLabelStyle(label) : {}];
    })
  );
};

export const encodeAnnotationsFile = (
  view: AnnotationToolsView
): AnnotationsFile => {
  const rulers = view.rulers.tools.map(encodeTwoPointTool);
  const rectangles = view.rectangles.tools.map(encodeTwoPointTool);
  const polygons = view.polygons.tools
    .filter((tool) => tool.points.length >= 3)
    .map(encodePolygonTool);

  const encoded = { rulers, rectangles, polygons };
  const labels = cleanUndefined(
    Object.fromEntries(
      ANNOTATION_TOOL_KINDS.map((kind) => {
        const referenced = new Set(
          encoded[kind].flatMap((tool) =>
            tool.labelName ? [tool.labelName] : []
          )
        );
        const namespace = encodeLabelNamespace(view[kind].labels, referenced);
        return [
          kind,
          Object.keys(namespace).length > 0 ? namespace : undefined,
        ];
      })
    ) as Record<AnnotationToolKind, Record<string, AnnotationLabel> | undefined>
  );

  const file = {
    schemaVersion: ANNOTATIONS_FILE_SCHEMA_VERSION,
    space: ANNOTATIONS_SPACE,
    ...(Object.keys(labels).length > 0 ? { labels } : {}),
    tools: cleanUndefined({
      rulers: rulers.length > 0 ? rulers : undefined,
      rectangles: rectangles.length > 0 ? rectangles : undefined,
      polygons: polygons.length > 0 ? polygons : undefined,
    }),
  };

  // A session can hold geometry the contract forbids — a non-finite coordinate,
  // a degenerate plane normal. Failing here names the offending field, where a
  // submitted file would come back as an opaque 400.
  return annotationsFileSchema.parse(file);
};

// What the file actually carries. Staging checks this rather than the view
// count, so an empty file can never be submitted.
export const annotationsFileCount = (file: AnnotationsFile): number =>
  ANNOTATION_TOOL_KINDS.reduce(
    (total, kind) => total + (file.tools[kind]?.length ?? 0),
    0
  );

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

// Normalized: every kind is present as an array, every namespace as a map, so
// consumers never branch on optionality.
export type DecodedAnnotationsFile = {
  schemaVersion: typeof ANNOTATIONS_FILE_SCHEMA_VERSION;
  space: typeof ANNOTATIONS_SPACE;
  labels: Record<AnnotationToolKind, Record<string, AnnotationLabel>>;
  tools: {
    rulers: WireRuler[];
    rectangles: WireRuler[];
    polygons: WirePolygon[];
  };
};

// The tool and label schemas are strict, so a parsed tool is already exactly the
// allowlisted shape — the only projection left is the one the wire does not do
// for us. Envelope extras survive the schema's passthrough and are dropped by
// the explicit shape returned below.
const withNormalizedPlane = <Tool extends WireRuler | WirePolygon>(
  tool: Tool
): Tool => ({
  ...tool,
  frameOfReference: {
    ...tool.frameOfReference,
    planeNormal: normalizePlaneNormal(tool.frameOfReference.planeNormal),
  },
});

/**
 * Validate an already-JSON-parsed annotations file and project it to the
 * allowlisted shape a store may consume. Throws on any structural or semantic
 * failure — a dangling label reference, a foreign `schemaVersion`/`space`, or a
 * session-only field on a tool — because a partly-understood file must never
 * mutate a session.
 */
export const decodeAnnotationsFile = (
  data: unknown
): DecodedAnnotationsFile => {
  const parsed = annotationsFileSchema.safeParse(data);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    const where = issue?.path?.length ? ` at ${issue.path.join('.')}` : '';
    throw new Error(
      `Invalid annotations file${where}: ${issue?.message ?? 'unknown error'}`
    );
  }
  const file = parsed.data;
  return {
    schemaVersion: ANNOTATIONS_FILE_SCHEMA_VERSION,
    space: ANNOTATIONS_SPACE,
    labels: {
      rulers: file.labels?.rulers ?? {},
      rectangles: file.labels?.rectangles ?? {},
      polygons: file.labels?.polygons ?? {},
    },
    tools: {
      rulers: (file.tools.rulers ?? []).map(withNormalizedPlane),
      rectangles: (file.tools.rectangles ?? []).map(withNormalizedPlane),
      polygons: (file.tools.polygons ?? []).map(withNormalizedPlane),
    },
  };
};
