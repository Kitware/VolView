import { describe, expect, it } from 'vitest';

import { annotationsFileSchema } from '@/backend-contract';
import { loadFixture } from '@/backend-contract/processing/__tests__/loadFixtures';
import {
  annotationToolsViewCount,
  annotationsFileCount,
  decodeAnnotationsFile,
  encodeAnnotationsFile,
  type AnnotationToolsView,
  type PolygonToolView,
  type TwoPointToolView,
} from '../annotationsWire';

const emptyAnnotationToolsView = (): AnnotationToolsView => ({
  rulers: { tools: [], labels: {} },
  rectangles: { tools: [], labels: {} },
  polygons: { tools: [], labels: {} },
});

// The contract's golden interchange file, read off disk so the client decoder
// and the backend's JSON Schema validate the exact same bytes.
// Typed loosely on purpose: the negative cases mutate it into the very shapes
// the schema must reject.
type GoldenTool = Record<string, unknown> & {
  frameOfReference?: { planeNormal: number[] };
};

type GoldenFile = {
  tools: Record<string, GoldenTool[]>;
  [key: string]: unknown;
};

const goldenFixture = () =>
  loadFixture('wire/annotations-file.json') as GoldenFile;

const axialFrame = {
  planeNormal: [0, 0, 1] as [number, number, number],
  planeOrigin: [0, 0, -12.5] as [number, number, number],
};

// A store tool as it really is: geometry and core plus every session-only field
// that must not reach the wire.
const sessionRuler = (
  overrides: Partial<TwoPointToolView> = {}
): TwoPointToolView =>
  ({
    id: 'tool-1',
    imageID: 'image-1',
    firstPoint: [-30.5, 12.25, -12.5],
    secondPoint: [18.75, 44, -12.5],
    frameOfReference: axialFrame,
    slice: 42,
    label: 'label-id-1',
    labelName: 'lesion',
    name: 'Ruler',
    color: '#ff0000',
    strokeWidth: 2,
    fillColor: '#00ff0033',
    hidden: false,
    placing: false,
    source: { providerId: 'p', jobId: 'j', outputId: 'o' },
    ...overrides,
  }) as TwoPointToolView;

const sessionPolygon = (
  overrides: Partial<PolygonToolView> = {}
): PolygonToolView =>
  ({
    id: 'tool-3',
    imageID: 'image-1',
    points: [
      [-20, 0, -12.5],
      [10, 0, -12.5],
      [10, 30, -12.5],
    ],
    frameOfReference: axialFrame,
    slice: 42,
    labelName: 'roi',
    name: 'Polygon',
    color: '#0000ff',
    placing: false,
    ...overrides,
  }) as PolygonToolView;

const viewOf = (overrides: Partial<AnnotationToolsView>): AnnotationToolsView =>
  ({ ...emptyAnnotationToolsView(), ...overrides }) as AnnotationToolsView;

// ---------------------------------------------------------------------------
// Encode: the session/wire boundary
// ---------------------------------------------------------------------------

describe('encodeAnnotationsFile', () => {
  it('stamps the fail-closed envelope', () => {
    const file = encodeAnnotationsFile(emptyAnnotationToolsView());
    expect(file.schemaVersion).toBe(1);
    expect(file.space).toBe('LPS');
  });

  it('drops every session-only field from a tool', () => {
    const file = encodeAnnotationsFile(
      viewOf({
        rulers: {
          tools: [sessionRuler()],
          labels: { 'label-id-1': { labelName: 'lesion', color: '#ff0000' } },
        },
      })
    );

    const [ruler] = file.tools.rulers!;
    expect(Object.keys(ruler).sort()).toEqual([
      'firstPoint',
      'frameOfReference',
      'labelName',
      'name',
      'secondPoint',
      'slice',
    ]);
    expect(ruler).not.toHaveProperty('id');
    expect(ruler).not.toHaveProperty('imageID');
    expect(ruler).not.toHaveProperty('color');
    expect(ruler).not.toHaveProperty('strokeWidth');
    expect(ruler).not.toHaveProperty('fillColor');
    expect(ruler).not.toHaveProperty('hidden');
    expect(ruler).not.toHaveProperty('placing');
    expect(ruler).not.toHaveProperty('label');
    expect(ruler).not.toHaveProperty('source');
  });

  it('carries geometry, the frame, and the advisory core', () => {
    const file = encodeAnnotationsFile(
      viewOf({
        rulers: {
          tools: [
            sessionRuler({
              frame: 3,
              metadata: { measuredBy: 'reader-1' },
            }),
          ],
          labels: { 'label-id-1': { labelName: 'lesion' } },
        },
      })
    );

    expect(file.tools.rulers![0]).toMatchObject({
      firstPoint: [-30.5, 12.25, -12.5],
      secondPoint: [18.75, 44, -12.5],
      frameOfReference: {
        planeNormal: [0, 0, 1],
        planeOrigin: [0, 0, -12.5],
      },
      slice: 42,
      frame: 3,
      labelName: 'lesion',
      name: 'Ruler',
      metadata: { measuredBy: 'reader-1' },
    });
  });

  it('omits the unset-slice sentinel rather than echoing a lie', () => {
    const file = encodeAnnotationsFile(
      viewOf({
        rulers: {
          tools: [sessionRuler({ slice: -1, labelName: '' })],
          labels: {},
        },
      })
    );
    expect(file.tools.rulers![0]).not.toHaveProperty('slice');
    expect(file.tools.rulers![0]).not.toHaveProperty('labelName');
  });

  it.each([
    [undefined, undefined],
    [0, 0],
    [3, 3],
    [-1, undefined],
    [1.5, undefined],
    [Number.NaN, undefined],
    [Number.POSITIVE_INFINITY, undefined],
    [Number.NEGATIVE_INFINITY, undefined],
  ])(
    'projects session frame %s to a contract-valid wire value',
    (frame, expected) => {
      const file = encodeAnnotationsFile(
        viewOf({
          rulers: {
            tools: [sessionRuler({ frame })],
            labels: { 'label-id-1': { labelName: 'lesion' } },
          },
        })
      );

      expect(file.tools.rulers![0].frame).toBe(expected);
      expect(annotationsFileSchema.safeParse(file).success).toBe(true);
    }
  );

  it('keeps the same label name independent per tool kind', () => {
    const file = encodeAnnotationsFile(
      viewOf({
        rulers: {
          tools: [sessionRuler()],
          labels: {
            'ruler-label': {
              labelName: 'lesion',
              color: '#ff0000',
              strokeWidth: 2,
            },
          },
        },
        rectangles: {
          tools: [sessionRuler({ id: 'tool-2' } as Partial<TwoPointToolView>)],
          labels: {
            'rect-label': {
              labelName: 'lesion',
              color: '#00ff00',
              strokeWidth: 1,
              fillColor: '#00ff0033',
            },
          },
        },
      })
    );

    expect(file.labels!.rulers).toEqual({
      lesion: { color: '#ff0000', strokeWidth: 2 },
    });
    expect(file.labels!.rectangles).toEqual({
      lesion: { color: '#00ff00', strokeWidth: 1, fillColor: '#00ff0033' },
    });
  });

  it('keeps a rectangle fill style in the label namespace, never on the tool', () => {
    const file = encodeAnnotationsFile(
      viewOf({
        rectangles: {
          tools: [sessionRuler({ name: 'Rectangle' })],
          labels: {
            'rect-label': { labelName: 'lesion', fillColor: '#00ff0033' },
          },
        },
      })
    );
    expect(file.tools.rectangles![0]).not.toHaveProperty('fillColor');
    expect(file.labels!.rectangles!.lesion.fillColor).toBe('#00ff0033');
  });

  it('prunes label namespaces to the names the tools reference', () => {
    const file = encodeAnnotationsFile(
      viewOf({
        rulers: {
          tools: [sessionRuler()],
          labels: {
            'ruler-label': { labelName: 'lesion', color: '#ff0000' },
            unused: { labelName: 'tumor', color: '#123456' },
          },
        },
      })
    );
    expect(Object.keys(file.labels!.rulers!)).toEqual(['lesion']);
  });

  it('declares a referenced name with no store label rather than dangling', () => {
    const file = encodeAnnotationsFile(
      viewOf({
        rulers: { tools: [sessionRuler({ labelName: 'orphan' })], labels: {} },
      })
    );
    expect(file.labels!.rulers).toEqual({ orphan: {} });
    // Fails closed downstream if it were dangling.
    expect(() => decodeAnnotationsFile(file)).not.toThrow();
  });

  it('skips a polygon with fewer than three points', () => {
    const file = encodeAnnotationsFile(
      viewOf({
        polygons: {
          tools: [
            sessionPolygon({
              points: [
                [0, 0, 0],
                [1, 1, 0],
              ],
            }),
            sessionPolygon(),
          ],
          labels: { 'poly-label': { labelName: 'roi', color: '#0000ff' } },
        },
      })
    );
    expect(file.tools.polygons).toHaveLength(1);
    expect(file.tools.polygons![0].points).toHaveLength(3);
  });

  // Session geometry the contract forbids is caught here rather than as a 400.
  it('refuses a non-finite coordinate', () => {
    expect(() =>
      encodeAnnotationsFile(
        viewOf({
          rulers: {
            tools: [sessionRuler({ firstPoint: [Number.NaN, 0, 0] })],
            labels: { 'label-id-1': { labelName: 'lesion' } },
          },
        })
      )
    ).toThrow();
  });

  it('refuses a degenerate plane normal', () => {
    expect(() =>
      encodeAnnotationsFile(
        viewOf({
          polygons: {
            tools: [
              sessionPolygon({
                frameOfReference: {
                  planeNormal: [0, 0, 0],
                  planeOrigin: [0, 0, 0],
                },
              }),
            ],
            labels: { 'poly-label': { labelName: 'roi' } },
          },
        })
      )
    ).toThrow(/nonzero vector/);
  });

  it('emits an empty but valid file when nothing is placed', () => {
    const file = encodeAnnotationsFile(emptyAnnotationToolsView());
    expect(file.tools).toEqual({});
    expect(file).not.toHaveProperty('labels');
    expect(() => decodeAnnotationsFile(file)).not.toThrow();
  });
});

describe('annotationToolsViewCount', () => {
  it('counts finished tools across all three kinds', () => {
    expect(annotationToolsViewCount(emptyAnnotationToolsView())).toBe(0);
    expect(
      annotationToolsViewCount(
        viewOf({
          rulers: { tools: [sessionRuler(), sessionRuler()], labels: {} },
          polygons: { tools: [sessionPolygon()], labels: {} },
        })
      )
    ).toBe(3);
  });
});

describe('annotationsFileCount', () => {
  it('counts what the file carries, not what the view held', () => {
    const view = viewOf({
      rulers: { tools: [sessionRuler()], labels: {} },
      polygons: {
        tools: [
          sessionPolygon({
            points: [
              [0, 0, 0],
              [1, 1, 0],
            ],
          }),
        ],
        labels: {},
      },
    });
    // The half-placed polygon is dropped on encode, so the two counts differ.
    expect(annotationToolsViewCount(view)).toBe(2);
    expect(annotationsFileCount(encodeAnnotationsFile(view))).toBe(1);
  });

  it('is zero for a file with nothing placed', () => {
    expect(
      annotationsFileCount(encodeAnnotationsFile(emptyAnnotationToolsView()))
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Decode: fail closed, then project
// ---------------------------------------------------------------------------

describe('decodeAnnotationsFile', () => {
  it('decodes the contract golden fixture', () => {
    const decoded = decodeAnnotationsFile(goldenFixture());

    expect(decoded.tools.rulers).toHaveLength(1);
    expect(decoded.tools.rectangles).toHaveLength(1);
    expect(decoded.tools.polygons).toHaveLength(1);
    expect(decoded.tools.rulers[0].metadata).toEqual({
      measuredBy: 'reader-1',
    });
    // The same name, two independent styles.
    expect(decoded.labels.rulers.lesion).toEqual({
      color: '#ff0000',
      strokeWidth: 2,
    });
    expect(decoded.labels.rectangles.lesion).toEqual({
      color: '#00ff00',
      strokeWidth: 1,
      fillColor: '#00ff0033',
    });
    expect(decoded.labels.polygons.roi).toEqual({ color: '#0000ff' });
  });

  it('normalizes absent kinds to empty arrays and namespaces', () => {
    const decoded = decodeAnnotationsFile({
      schemaVersion: 1,
      space: 'LPS',
      tools: {},
    });
    expect(decoded.tools).toEqual({ rulers: [], rectangles: [], polygons: [] });
    expect(decoded.labels).toEqual({
      rulers: {},
      rectangles: {},
      polygons: {},
    });
  });

  it.each([
    [
      [0, 0, 2],
      [0, 0, 1],
    ],
    [
      [0, 0, -3],
      [0, 0, -1],
    ],
    [
      [0, 0, 0.99999],
      [0, 0, 1],
    ],
  ])('normalizes a nonzero plane normal %j', (planeNormal, expected) => {
    const file = goldenFixture();
    file.tools.rulers[0].frameOfReference!.planeNormal = planeNormal;

    const decoded = decodeAnnotationsFile(file);

    expect(decoded.tools.rulers[0].frameOfReference.planeNormal).toEqual(
      expected
    );
  });

  it('rejects a zero plane normal', () => {
    const file = goldenFixture();
    file.tools.rulers[0].frameOfReference!.planeNormal = [0, 0, 0];
    expect(() => decodeAnnotationsFile(file)).toThrow(/nonzero vector/);
  });

  it('rejects a foreign schemaVersion or space', () => {
    const golden = goldenFixture();
    expect(() =>
      decodeAnnotationsFile({ ...golden, schemaVersion: 2 })
    ).toThrow(/annotations file/i);
    expect(() => decodeAnnotationsFile({ ...golden, space: 'RAS' })).toThrow(
      /annotations file/i
    );
  });

  it('rejects a dangling label reference', () => {
    const golden = goldenFixture();
    golden.tools.rulers[0].labelName = 'not-declared';
    expect(() => decodeAnnotationsFile(golden)).toThrow(/not-declared/);
  });

  it('rejects a dangling reference across namespaces', () => {
    const golden = goldenFixture();
    // 'roi' is declared for polygons only.
    golden.tools.rulers[0].labelName = 'roi';
    expect(() => decodeAnnotationsFile(golden)).toThrow(/labels\.rulers/);
  });

  it('rejects a session-only field smuggled onto a tool', () => {
    const golden = goldenFixture();
    golden.tools.rulers[0].imageID = 'image-1';
    expect(() => decodeAnnotationsFile(golden)).toThrow(/annotations file/i);
  });

  it('rejects a polygon with fewer than three points', () => {
    const golden = goldenFixture();
    golden.tools.polygons[0].points = [
      [0, 0, 0],
      [1, 1, 0],
    ];
    expect(() => decodeAnnotationsFile(golden)).toThrow(/annotations file/i);
  });

  it('rejects a tool with no frame of reference', () => {
    const golden = goldenFixture();
    delete golden.tools.rulers[0].frameOfReference;
    expect(() => decodeAnnotationsFile(golden)).toThrow(/annotations file/i);
  });

  it('drops an unrecognized envelope field the schema lets through', () => {
    const golden = goldenFixture();
    golden.producer = 'some-cli';
    const decoded = decodeAnnotationsFile(golden);
    expect(decoded).not.toHaveProperty('producer');
  });

  it('round-trips an encoded file', () => {
    const view = viewOf({
      rulers: {
        tools: [sessionRuler()],
        labels: { 'ruler-label': { labelName: 'lesion', color: '#ff0000' } },
      },
      rectangles: {
        tools: [sessionRuler({ name: 'Rectangle' })],
        labels: {
          'rect-label': { labelName: 'lesion', fillColor: '#00ff0033' },
        },
      },
      polygons: {
        tools: [sessionPolygon()],
        labels: { 'poly-label': { labelName: 'roi', color: '#0000ff' } },
      },
    });

    const encoded = encodeAnnotationsFile(view);
    const decoded = decodeAnnotationsFile(JSON.parse(JSON.stringify(encoded)));

    expect(decoded.tools.rulers).toEqual(encoded.tools.rulers);
    expect(decoded.tools.rectangles).toEqual(encoded.tools.rectangles);
    expect(decoded.tools.polygons).toEqual(encoded.tools.polygons);
    expect(decoded.labels.rulers).toEqual(encoded.labels!.rulers);
    expect(decoded.labels.rectangles).toEqual(encoded.labels!.rectangles);
    expect(decoded.labels.polygons).toEqual(encoded.labels!.polygons);
  });
});
