import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ANNOTATIONS_FILE_SCHEMA_VERSION,
  ANNOTATIONS_SPACE,
  ANNOTATION_TOOL_KINDS,
  annotationLabelSchema,
  annotationsFileSchema,
  annotationsFileStructuralSchema,
  validateAnnotationsFileSemantics,
  wirePolygonSchema,
  wireRectangleSchema,
  wireRulerSchema,
} from '../annotations';
import { generateJsonSchemas } from '../schema-json';
import { loadFixture } from './loadFixtures';

const golden = () => loadFixture('wire/annotations-file.json');

// Parse once so the fixture-derived clones below have a typed object source.
const goldenParsed = () => annotationsFileSchema.parse(golden());

// ---------------------------------------------------------------------------
// The golden interchange example
// ---------------------------------------------------------------------------

describe('the golden annotations interchange file', () => {
  it('pins the fail-closed envelope constants', () => {
    expect(ANNOTATIONS_FILE_SCHEMA_VERSION).toBe(1);
    expect(ANNOTATIONS_SPACE).toBe('LPS');
    expect([...ANNOTATION_TOOL_KINDS]).toEqual([
      'rulers',
      'rectangles',
      'polygons',
    ]);
  });

  it('validates and carries one of each tool kind', () => {
    const file = goldenParsed();
    expect(file.schemaVersion).toBe(1);
    expect(file.space).toBe('LPS');
    expect(file.tools.rulers).toHaveLength(1);
    expect(file.tools.rectangles).toHaveLength(1);
    expect(file.tools.polygons).toHaveLength(1);
  });

  it('keeps the SAME label name independent per tool kind, with its own style', () => {
    // The whole reason the label namespaces are per tool kind: the three client
    // stores are independent and may legally style `lesion` differently.
    const file = goldenParsed();
    expect(file.tools.rulers?.[0].labelName).toBe('lesion');
    expect(file.tools.rectangles?.[0].labelName).toBe('lesion');
    expect(file.labels?.rulers?.lesion.color).toBe('#ff0000');
    expect(file.labels?.rectangles?.lesion.color).toBe('#00ff00');
    expect(file.labels?.rulers?.lesion).not.toHaveProperty('fillColor');
    expect(file.labels?.rectangles?.lesion.fillColor).toBe('#00ff0033');
  });

  it('carries advisory per-tool metadata', () => {
    const file = goldenParsed();
    expect(file.tools.rulers?.[0].metadata).toEqual({
      measuredBy: 'reader-1',
    });
  });

  it('has no semantic issues', () => {
    expect(validateAnnotationsFileSemantics(golden())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed envelope
// ---------------------------------------------------------------------------

describe('the envelope fails closed', () => {
  it.each([
    ['a future schemaVersion', 'negative/annotations-bad-schema-version.json'],
    ['a non-LPS space', 'negative/annotations-bad-space.json'],
  ])('rejects %s', (_label, path) => {
    expect(annotationsFileSchema.safeParse(loadFixture(path)).success).toBe(
      false
    );
  });

  it('requires the tools envelope', () => {
    expect(
      annotationsFileSchema.safeParse({ schemaVersion: 1, space: 'LPS' })
        .success
    ).toBe(false);
  });

  it('accepts an empty tools envelope (a valid, empty result)', () => {
    const file = annotationsFileSchema.parse({
      schemaVersion: 1,
      space: 'LPS',
      tools: {},
    });
    expect(file.tools.rulers).toBeUndefined();
  });

  it('preserves an unrecognized producer field on the envelope', () => {
    const file = annotationsFileSchema.parse({
      ...goldenParsed(),
      producerHint: 'keep-me',
    }) as Record<string, unknown>;
    expect(file.producerHint).toBe('keep-me');
  });

  it('rejects a false labels envelope rather than treating it as absent', () => {
    expect(
      annotationsFileSchema.safeParse({
        schemaVersion: 1,
        space: 'LPS',
        labels: false,
        tools: {},
      }).success
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Strict per-tool records — no session state on the wire
// ---------------------------------------------------------------------------

describe('per-tool records are strict', () => {
  const ruler = () => ({
    firstPoint: [0, 0, 0],
    secondPoint: [1, 1, 0],
    frameOfReference: { planeNormal: [0, 0, 1], planeOrigin: [0, 0, 0] },
  });

  it.each([
    'id',
    'imageID',
    'color',
    'strokeWidth',
    'fillColor',
    'hidden',
    'placing',
    'source',
    'label',
  ])('rejects the session-only field %s', (field) => {
    expect(
      wireRulerSchema.safeParse({ ...ruler(), [field]: 'x' }).success
    ).toBe(false);
  });

  it('rejects a forbidden session field inside the whole file', () => {
    const bad = loadFixture('negative/annotations-session-field.json');
    expect(annotationsFileSchema.safeParse(bad).success).toBe(false);
  });

  it('requires a frame of reference', () => {
    const { frameOfReference, ...noFrame } = ruler();
    void frameOfReference;
    expect(wireRulerSchema.safeParse(noFrame).success).toBe(false);
  });

  it('accepts a scaled nonzero plane normal', () => {
    expect(
      wireRulerSchema.safeParse({
        ...ruler(),
        frameOfReference: {
          planeNormal: [0, 0, 2],
          planeOrigin: [0, 0, 0],
        },
      }).success
    ).toBe(true);
  });

  it('rejects an extra frame-of-reference field', () => {
    expect(
      wireRulerSchema.safeParse({
        ...ruler(),
        frameOfReference: {
          ...ruler().frameOfReference,
          coordinateSystem: 'LPS',
        },
      }).success
    ).toBe(false);
  });

  it('requires three-component points', () => {
    expect(
      wireRulerSchema.safeParse({ ...ruler(), secondPoint: [1, 1] }).success
    ).toBe(false);
  });

  it('accepts opposite corners for an image-axis-aligned rectangle', () => {
    expect(wireRectangleSchema.safeParse(ruler()).success).toBe(true);
  });

  it('rejects a polygon with fewer than three points', () => {
    const bad = loadFixture('negative/annotations-two-point-polygon.json');
    expect(annotationsFileSchema.safeParse(bad).success).toBe(false);
    expect(
      wirePolygonSchema.safeParse({
        points: [
          [0, 0, 0],
          [1, 0, 0],
        ],
        frameOfReference: { planeNormal: [0, 0, 1], planeOrigin: [0, 0, 0] },
      }).success
    ).toBe(false);
  });

  it('accepts the advisory slice/frame echoes', () => {
    expect(
      wireRulerSchema.safeParse({ ...ruler(), slice: 42, frame: 3 }).success
    ).toBe(true);
  });

  it('requires finite coordinates', () => {
    expect(
      wireRulerSchema.safeParse({ ...ruler(), firstPoint: [Infinity, 0, 0] })
        .success
    ).toBe(false);
    expect(
      wireRulerSchema.safeParse({ ...ruler(), secondPoint: [0, NaN, 0] })
        .success
    ).toBe(false);
  });

  // A frame indexes a cine loop: only a non-negative integer is honorable.
  it.each([1.5, -1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects frame %s',
    (frame) => {
      expect(wireRulerSchema.safeParse({ ...ruler(), frame }).success).toBe(
        false
      );
    }
  );

  it('rejects an explicit null labelName', () => {
    expect(
      wireRulerSchema.safeParse({ ...ruler(), labelName: null }).success
    ).toBe(false);
  });

  it('rejects a non-finite slice echo', () => {
    expect(
      wireRulerSchema.safeParse({ ...ruler(), slice: Infinity }).success
    ).toBe(false);
  });

  it.each([
    ['a non-object body', false],
    ['an unknown style field', { opacity: 0.5 }],
    ['a non-string color', { color: 123 }],
    ['a non-number stroke width', { strokeWidth: '2' }],
  ])('rejects a label with %s', (_case, label) => {
    expect(annotationLabelSchema.safeParse(label).success).toBe(false);
  });

  it('reserves __proto__ in label and metadata records', () => {
    const unsafeLabels = JSON.parse('{"__proto__": {}}');
    const unsafeMetadata = JSON.parse('{"__proto__": "value"}');
    expect(
      annotationsFileSchema.safeParse({
        schemaVersion: 1,
        space: 'LPS',
        labels: { rulers: unsafeLabels },
        tools: {},
      }).success
    ).toBe(false);
    expect(
      annotationsFileSchema.safeParse({
        schemaVersion: 1,
        space: 'LPS',
        tools: {
          rulers: [{ ...ruler(), metadata: unsafeMetadata }],
        },
      }).success
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Label-reference integrity — the semantic pass
// ---------------------------------------------------------------------------

describe('label references are namespaced and must resolve', () => {
  it('rejects a zero plane normal through the semantic pass', () => {
    const bad = loadFixture('negative/annotations-zero-normal.json');
    expect(annotationsFileStructuralSchema.safeParse(bad).success).toBe(true);
    expect(annotationsFileSchema.safeParse(bad).success).toBe(false);
    expect(validateAnnotationsFileSemantics(bad)).toEqual([
      {
        message: 'planeNormal must be a nonzero vector',
        path: ['tools', 'rulers', 0, 'frameOfReference', 'planeNormal'],
      },
    ]);
  });

  it('rejects a labelName declared only in ANOTHER tool kind', () => {
    const bad = loadFixture('negative/annotations-dangling-label.json');
    // Structurally fine: only the semantic pass can see the dangling reference.
    expect(annotationsFileStructuralSchema.safeParse(bad).success).toBe(true);
    expect(annotationsFileSchema.safeParse(bad).success).toBe(false);
    expect(validateAnnotationsFileSemantics(bad)).toEqual([
      {
        message: 'labelName lesion is not declared in labels.rulers',
        path: ['tools', 'rulers', 0, 'labelName'],
      },
    ]);
  });

  it('rejects any labelName when the file declares no labels at all', () => {
    expect(
      annotationsFileSchema.safeParse({
        schemaVersion: 1,
        space: 'LPS',
        tools: {
          rulers: [
            {
              firstPoint: [0, 0, 0],
              secondPoint: [1, 1, 0],
              frameOfReference: {
                planeNormal: [0, 0, 1],
                planeOrigin: [0, 0, 0],
              },
              labelName: 'lesion',
            },
          ],
        },
      }).success
    ).toBe(false);
  });

  it('accepts an unlabeled tool (labelName omitted)', () => {
    expect(
      annotationsFileSchema.safeParse({
        schemaVersion: 1,
        space: 'LPS',
        tools: {
          rulers: [
            {
              firstPoint: [0, 0, 0],
              secondPoint: [1, 1, 0],
              frameOfReference: {
                planeNormal: [0, 0, 1],
                planeOrigin: [0, 0, 0],
              },
            },
          ],
        },
      }).success
    ).toBe(true);
  });

  it('reports one issue per dangling reference, addressed by path', () => {
    const file = goldenParsed();
    file.tools.polygons![0].labelName = 'not-declared';
    expect(validateAnnotationsFileSemantics(file)).toEqual([
      {
        message: 'labelName not-declared is not declared in labels.polygons',
        path: ['tools', 'polygons', 0, 'labelName'],
      },
    ]);
  });

  it('returns no issues for a non-object payload (structural pass owns that)', () => {
    expect(validateAnnotationsFileSemantics(null)).toEqual([]);
    expect(validateAnnotationsFileSemantics('nope')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// One definition, two validators
// ---------------------------------------------------------------------------

describe('the generated annotations-file schema agrees with the zod source', () => {
  const generated = generateJsonSchemas()['annotations-file'];

  it('names the required semantic pass in the artifact itself', () => {
    expect((generated as { $comment?: string }).$comment).toContain(
      'validateAnnotationsFileSemantics'
    );
  });

  it('structurally accepts the golden fixture', () => {
    const structural = z.fromJSONSchema(generated);
    expect(structural.safeParse(golden()).success).toBe(true);
  });

  it('leaves the zero-normal rule to the named semantic pass', () => {
    const structural = z.fromJSONSchema(generated);
    expect(
      structural.safeParse(loadFixture('negative/annotations-zero-normal.json'))
        .success
    ).toBe(true);
  });

  it('structurally rejects the envelope and shape negatives', () => {
    const structural = z.fromJSONSchema(generated);
    [
      'negative/annotations-bad-schema-version.json',
      'negative/annotations-bad-space.json',
      'negative/annotations-two-point-polygon.json',
      'negative/annotations-session-field.json',
    ].forEach((path) => {
      expect(
        structural.safeParse(loadFixture(path)).success,
        `expected ${path} to be rejected structurally`
      ).toBe(false);
    });
  });

  it('closes the point tuples to exactly three components', () => {
    const structural = z.fromJSONSchema(generated);
    const file = goldenParsed();
    file.tools.rulers![0].secondPoint = [1, 1, 0, 1] as never;
    expect(structural.safeParse(file).success).toBe(false);
  });

  it('carries the reserved record-key rule into JSON Schema', () => {
    const at = (path: string[]) =>
      path.reduce(
        (node, key) => node[key] as Record<string, unknown>,
        generated as Record<string, unknown>
      );
    ANNOTATION_TOOL_KINDS.forEach((kind) => {
      [
        ['properties', 'labels', 'properties', kind],
        [
          'properties',
          'tools',
          'properties',
          kind,
          'items',
          'properties',
          'metadata',
        ],
      ].forEach((path) => {
        expect(at(path).propertyNames).toMatchObject({
          pattern: '^(?!__proto__$)',
        });
      });
    });
  });
});
