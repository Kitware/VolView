import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

import { applyIntent } from '@/src/processing/applyResults';
import type { SubmittedJobContext } from '@/src/processing/types';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { usePolygonStore } from '@/src/store/tools/polygons';

// ---------------------------------------------------------------------------
// Applying an `add-annotations` result.
//
// The stores are REAL here: the contract this exercises is what actually lands
// in a session — the derived slice, the label ids `addTool` re-reads styles
// from, and the durable `source` receipt — none of which a store double could
// tell the truth about. Only the heavy import/download edges are mocked.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  fetchProcessingResult: vi.fn(),
}));

vi.mock('@/src/processing/engine/resultDownload', () => ({
  fetchProcessingResult: mocks.fetchProcessingResult,
}));
vi.mock('@/src/io/import/dataSource', () => ({ uriToDataSource: vi.fn() }));
vi.mock('@/src/io/import/importDataSources', () => ({
  importVolumeDataSources: vi.fn(),
  toDataSelection: vi.fn(),
}));
vi.mock('@/src/io/import/common', () => ({ isVolumeResult: vi.fn() }));
vi.mock('@/src/actions/loadUserFiles', () => ({ loadVolumeUrls: vi.fn() }));

const IMAGE_ID = 'img-1';

// A 20mm cube at the origin with unit spacing: world LPS mm and image indices
// coincide, so a plane origin's z IS its slice.
function seatImage(id = IMAGE_ID) {
  const image = vtkImageData.newInstance();
  image.setDimensions(20, 20, 20);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      name: 'scalars',
      numberOfComponents: 1,
      values: new Uint8Array(20 * 20 * 20),
    })
  );
  return useImageCacheStore().addVTKImageData(image, 'CT', { id });
}

const axialAt = (z: number) => ({
  planeNormal: [0, 0, 1],
  planeOrigin: [0, 0, z],
});

const context = (activeDatasetId?: string): SubmittedJobContext => ({
  jobId: 'job-1',
  taskId: 'task-1',
  providerId: 'provider-1',
  submittedAt: '2026-07-27T00:00:00Z',
  activeDatasetId,
});

const source = {
  providerId: 'provider-1',
  jobId: 'job-1',
  outputId: 'outputAnnotations',
};

const intent = (overrides: Record<string, unknown> = {}) =>
  ({
    intent: 'add-annotations',
    id: 'r1',
    name: 'out.annotations.json',
    url: 'https://example/out.annotations.json',
    source,
    ...overrides,
  }) as never;

// Wire files are hand-written rather than encoded from a view: this is the
// producer's half of the boundary, and a task is not VolView. Typed loosely on
// purpose so a test can bend one field into something a producer might emit.
type WireLabels = Record<
  string,
  { color?: string; strokeWidth?: number; fillColor?: string }
>;
type WireTool = Record<string, unknown>;
type WireFile = {
  schemaVersion: unknown;
  space: unknown;
  labels: { rulers: WireLabels; rectangles: WireLabels; polygons: WireLabels };
  tools: { rulers: WireTool[]; rectangles: WireTool[]; polygons: WireTool[] };
};

const annotationsFile = (): WireFile => ({
  schemaVersion: 1,
  space: 'LPS',
  labels: {
    // The SAME name in two namespaces with different styles — legal, because
    // the stores are independent.
    rulers: { roi: { color: '#ff0000', strokeWidth: 3 } },
    rectangles: { roi: { color: '#00ff00', fillColor: '#00ff0033' } },
    polygons: { lesion: { color: '#0000ff' } },
  },
  tools: {
    rulers: [
      {
        firstPoint: [1, 1, 5],
        secondPoint: [4, 4, 5],
        frameOfReference: axialAt(5),
        labelName: 'roi',
        name: 'Long axis',
        // Advisory only, and deliberately a lie: the applier re-derives 5.
        slice: 99,
        metadata: { origin: 'RulerToRectangle' },
      },
    ],
    rectangles: [
      {
        firstPoint: [2, 2, 7],
        secondPoint: [6, 6, 7],
        frameOfReference: axialAt(7),
        labelName: 'roi',
      },
    ],
    polygons: [
      {
        points: [
          [1, 1, 3],
          [5, 1, 3],
          [3, 5, 3],
        ],
        frameOfReference: axialAt(3),
        labelName: 'lesion',
      },
    ],
  },
});

const serveFile = (body: unknown) => {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  mocks.fetchProcessingResult.mockResolvedValue(
    new File([text], 'out.annotations.json', { type: 'application/json' })
  );
};

const toolCounts = () => ({
  rulers: useRulerStore().toolIDs.length,
  rectangles: useRectangleStore().toolIDs.length,
  polygons: usePolygonStore().toolIDs.length,
});

const onlyTool = (store: {
  toolIDs: string[];
  toolByID: Record<string, any>;
}) => store.toolByID[store.toolIDs[0]];

beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
  seatImage();
  serveFile(annotationsFile());
});

describe('applyIntent — add-annotations', () => {
  it('adds every tool kind to the job image, deriving the slice from the frame', async () => {
    const outcome = await applyIntent(intent(), context(IMAGE_ID));
    expect(outcome.status).toBe('applied');
    expect(toolCounts()).toEqual({ rulers: 1, rectangles: 1, polygons: 1 });

    const ruler = onlyTool(useRulerStore());
    expect(ruler.imageID).toBe(IMAGE_ID);
    // The wire said 99; the frame of reference says 5, and it wins.
    expect(ruler.slice).toBe(5);
    expect(ruler.firstPoint).toEqual([1, 1, 5]);
    expect(ruler.secondPoint).toEqual([4, 4, 5]);
    expect(ruler.name).toBe('Long axis');
    expect(ruler.metadata).toEqual({ origin: 'RulerToRectangle' });
    expect(ruler.placing).toBe(false);
    // The idempotency receipt is durable session state.
    expect(ruler.source).toEqual(source);

    expect(onlyTool(useRectangleStore()).slice).toBe(7);
    expect(onlyTool(usePolygonStore())).toMatchObject({
      slice: 3,
      imageID: IMAGE_ID,
      points: [
        [1, 1, 3],
        [5, 1, 3],
        [3, 5, 3],
      ],
    });
  });

  it('applies native rectangles on a rotated acquisition without inventing a basis', async () => {
    const half = Math.sqrt(0.5);
    const image = vtkImageData.newInstance();
    image.setDimensions(20, 20, 20);
    image.setDirection([half, half, 0, -half, half, 0, 0, 0, 1]);
    image.getPointData().setScalars(
      vtkDataArray.newInstance({
        name: 'scalars',
        numberOfComponents: 1,
        values: new Uint8Array(20 * 20 * 20),
      })
    );
    const imageID = 'rotated-image';
    useImageCacheStore().addVTKImageData(image, 'CT', { id: imageID });
    await nextTick();

    const file = annotationsFile();
    file.tools.rulers = [];
    file.tools.polygons = [];
    file.tools.rectangles = [
      {
        firstPoint: [-2, 2, 7],
        secondPoint: [2, 6, 7],
        frameOfReference: axialAt(7),
        labelName: 'roi',
      },
    ];
    serveFile(file);

    const outcome = await applyIntent(intent(), context(imageID));

    expect(
      outcome.status,
      String((outcome as { error?: Error }).error ?? '')
    ).toBe('applied');
    expect(onlyTool(useRectangleStore())).toMatchObject({
      imageID,
      firstPoint: [-2, 2, 7],
      secondPoint: [2, 6, 7],
      slice: 7,
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
  ])(
    'normalizes plane normal %j before axis matching and storage',
    async (planeNormal, expected) => {
      const file = annotationsFile();
      file.tools.rulers[0].frameOfReference = {
        planeNormal,
        planeOrigin: [0, 0, 5],
      };
      serveFile(file);

      const outcome = await applyIntent(intent(), context(IMAGE_ID));

      expect(outcome.status).toBe('applied');
      expect(onlyTool(useRulerStore()).frameOfReference.planeNormal).toEqual(
        expected
      );
    }
  );

  it('rejects a zero plane normal before mutating any store', async () => {
    const file = annotationsFile();
    file.tools.polygons[0].frameOfReference = {
      planeNormal: [0, 0, 0],
      planeOrigin: [0, 0, 3],
    };
    serveFile(file);

    const outcome = await applyIntent(intent(), context(IMAGE_ID));

    expect(outcome.status).toBe('failed');
    expect(String((outcome as { error: Error }).error)).toContain(
      'nonzero vector'
    );
    expect(toolCounts()).toEqual({ rulers: 0, rectangles: 0, polygons: 0 });
  });

  it('keeps a label name that repeats across kinds independent per store', async () => {
    await applyIntent(intent(), context(IMAGE_ID));

    const ruler = onlyTool(useRulerStore());
    const rectangle = onlyTool(useRectangleStore());
    expect(ruler.labelName).toBe('roi');
    expect(rectangle.labelName).toBe('roi');
    expect(ruler.label).not.toBe(rectangle.label);

    // addTool re-reads the style from the merged label, so these ARE the
    // namespaced styles that landed.
    expect(ruler.color).toBe('#ff0000');
    expect(ruler.strokeWidth).toBe(3);
    expect(rectangle.color).toBe('#00ff00');
    expect(rectangle.fillColor).toBe('#00ff0033');
    expect(onlyTool(usePolygonStore()).color).toBe('#0000ff');
  });

  it('merges into an existing label of the same name instead of duplicating it', async () => {
    const rulerStore = useRulerStore();
    // 'Label 1' ships as the stores' default label.
    const [existingId] = Object.keys(rulerStore.labels);
    const before = Object.keys(rulerStore.labels).length;

    const file = annotationsFile();
    file.labels.rulers = { 'Label 1': { color: '#123456', strokeWidth: 3 } };
    file.tools.rulers[0].labelName = 'Label 1';
    file.tools.rectangles = [];
    file.tools.polygons = [];
    serveFile(file);

    expect((await applyIntent(intent(), context(IMAGE_ID))).status).toBe(
      'applied'
    );
    expect(Object.keys(rulerStore.labels)).toHaveLength(before);
    expect(rulerStore.labels[existingId].color).toBe('#123456');
    expect(onlyTool(rulerStore).label).toBe(existingId);
  });

  it('leaves the label picker where the user left it', async () => {
    const rulerStore = useRulerStore();
    const activeBefore = rulerStore.activeLabel;
    expect(activeBefore).toBeTruthy();

    const file = annotationsFile();
    // A name no store label carries, so merging must ADD one — the case that
    // could steal the active selection.
    file.labels.rulers = { fresh: { color: '#abcdef' } };
    file.tools.rulers[0].labelName = 'fresh';
    serveFile(file);

    expect((await applyIntent(intent(), context(IMAGE_ID))).status).toBe(
      'applied'
    );
    expect(rulerStore.activeLabel).toBe(activeBefore);
    // The label still landed; only the picker was left alone.
    expect(onlyTool(rulerStore).labelName).toBe('fresh');
  });

  it('leaves an unlabeled tool unlabeled', async () => {
    const file = annotationsFile();
    file.labels = { rulers: {}, rectangles: {}, polygons: {} };
    file.tools.rulers = [
      {
        firstPoint: [1, 1, 5],
        secondPoint: [4, 4, 5],
        frameOfReference: axialAt(5),
      },
    ];
    file.tools.rectangles = [];
    file.tools.polygons = [];
    serveFile(file);

    expect((await applyIntent(intent(), context(IMAGE_ID))).status).toBe(
      'applied'
    );
    const ruler = onlyTool(useRulerStore());
    expect(ruler.label).toBe('');
    expect(ruler.labelName).toBe('');
  });

  it('is a no-op when a tool already carries the same source', async () => {
    expect((await applyIntent(intent(), context(IMAGE_ID))).status).toBe(
      'applied'
    );
    mocks.fetchProcessingResult.mockClear();

    const second = await applyIntent(intent(), context(IMAGE_ID));
    expect(second.status).toBe('applied');
    expect(toolCounts()).toEqual({ rulers: 1, rectangles: 1, polygons: 1 });
    // The receipt short-circuits before the download.
    expect(mocks.fetchProcessingResult).not.toHaveBeenCalled();
  });

  it('re-applies a result from a different job even at the same output id', async () => {
    await applyIntent(intent(), context(IMAGE_ID));
    const other = { ...source, jobId: 'job-2' };
    await applyIntent(intent({ source: other }), context(IMAGE_ID));
    expect(toolCounts()).toEqual({ rulers: 2, rectangles: 2, polygons: 2 });
  });

  it('applies an empty result as a no-op', async () => {
    serveFile({ schemaVersion: 1, space: 'LPS', tools: {} });
    const outcome = await applyIntent(intent(), context(IMAGE_ID));
    expect(outcome.status).toBe('applied');
    expect(toolCounts()).toEqual({ rulers: 0, rectangles: 0, polygons: 0 });
  });

  it('fails without ever downloading when no image is bound', async () => {
    const outcome = await applyIntent(intent(), context(undefined));
    expect(outcome.status).toBe('failed');
    expect(String((outcome as { error: Error }).error)).toContain(
      "Load the job's input image"
    );
    expect(mocks.fetchProcessingResult).not.toHaveBeenCalled();
    expect(toolCounts()).toEqual({ rulers: 0, rectangles: 0, polygons: 0 });
  });

  it('fails when the bound image is no longer in the cache', async () => {
    const outcome = await applyIntent(intent(), context('img-gone'));
    expect(outcome.status).toBe('failed');
    expect(mocks.fetchProcessingResult).not.toHaveBeenCalled();
  });

  it('fails on a malformed result body without touching the stores', async () => {
    serveFile('not json at all');
    const outcome = await applyIntent(intent(), context(IMAGE_ID));
    expect(outcome.status).toBe('failed');
    expect(toolCounts()).toEqual({ rulers: 0, rectangles: 0, polygons: 0 });
  });

  it('rejects the whole result when any frame is not axis-aligned, before mutating', async () => {
    const rulerStore = useRulerStore();
    const labelsBefore = { ...rulerStore.labels };

    const file = annotationsFile();
    // Oblique: unrenderable, and no `slice` echo can rescue it.
    file.tools.polygons[0].frameOfReference = {
      planeNormal: [0, 0.7071, 0.7071],
      planeOrigin: [0, 0, 3],
    };
    serveFile(file);

    const outcome = await applyIntent(intent(), context(IMAGE_ID));
    expect(outcome.status).toBe('failed');
    expect(String((outcome as { error: Error }).error)).toContain(
      'not aligned'
    );
    // All-or-nothing: not even the rulers that WOULD have placed, and not the
    // labels — merging restyles, so it is a mutation too.
    expect(toolCounts()).toEqual({ rulers: 0, rectangles: 0, polygons: 0 });
    expect(rulerStore.labels).toEqual(labelsBefore);
  });

  it('places a plane past the image bounds, as the renderer already does', async () => {
    const file = annotationsFile();
    file.tools.rectangles = [];
    file.tools.polygons = [];
    file.tools.rulers[0].frameOfReference = axialAt(500);
    serveFile(file);

    const outcome = await applyIntent(intent(), context(IMAGE_ID));

    expect(outcome.status).toBe('applied');
    expect(onlyTool(useRulerStore()).slice).toBe(500);
  });

  it('rejects a plane that falls between slices, and says so', async () => {
    const file = annotationsFile();
    file.tools.rulers[0].frameOfReference = axialAt(5.5);
    serveFile(file);

    const outcome = await applyIntent(intent(), context(IMAGE_ID));

    expect(outcome.status).toBe('failed');
    expect(String((outcome as { error: Error }).error)).toContain(
      'between slices'
    );
    expect(toolCounts()).toEqual({ rulers: 0, rectangles: 0, polygons: 0 });
  });

  it('rejects a dangling label reference', async () => {
    const file = annotationsFile();
    file.tools.rulers[0].labelName = 'undeclared';
    serveFile(file);
    expect((await applyIntent(intent(), context(IMAGE_ID))).status).toBe(
      'failed'
    );
    expect(toolCounts()).toEqual({ rulers: 0, rectangles: 0, polygons: 0 });
  });

  it('refuses session-only state on the wire, so it can never reach a store', async () => {
    const file = annotationsFile();
    Object.assign(file.tools.rulers[0], {
      id: 'smuggled',
      imageID: 'some-other-image',
      color: '#000000',
      hidden: true,
      source: 'x:y:z',
    });
    serveFile(file);

    const outcome = await applyIntent(intent(), context(IMAGE_ID));
    expect(outcome.status).toBe('failed');
    expect(toolCounts()).toEqual({ rulers: 0, rectangles: 0, polygons: 0 });
  });

  it('applies without a source when the producer omitted one', async () => {
    const outcome = await applyIntent(
      intent({ source: undefined }),
      context(IMAGE_ID)
    );
    expect(outcome.status).toBe('applied');
    expect(onlyTool(useRulerStore()).source).toBeUndefined();
  });

  // A stored `frame` flips a tool into cine semantics (render slice,
  // visibility, jump-to), so the preflight judges it against the TARGET image.
  describe('the advisory frame against the target image', () => {
    const markCine = (frames: number, id = IMAGE_ID) => {
      useDICOMStore().volumeInfo[id] = {
        NumberOfSlices: frames,
        VolumeID: id,
        Modality: 'US',
        SeriesInstanceUID: '1.2.3.4',
        SeriesNumber: '1',
        SeriesDescription: 'clip',
        WindowLevel: '128',
        WindowWidth: '256',
        kind: 'cine',
      };
    };

    const rulerOnlyFile = (frame?: unknown) => {
      const file = annotationsFile();
      file.tools.rulers = [
        {
          firstPoint: [1, 1, 5],
          secondPoint: [4, 4, 5],
          frameOfReference: axialAt(5),
          ...(frame === undefined ? {} : { frame }),
        },
      ];
      file.labels.rulers = {};
      file.tools.rectangles = [];
      file.tools.polygons = [];
      serveFile(file);
    };

    it('drops a stray frame when the target is a static volume', async () => {
      rulerOnlyFile(3);
      const outcome = await applyIntent(intent(), context(IMAGE_ID));
      expect(outcome.status).toBe('applied');
      expect(onlyTool(useRulerStore()).frame).toBeUndefined();
    });

    it('keeps an in-range integral frame on a cine target', async () => {
      markCine(8);
      rulerOnlyFile(7);
      const outcome = await applyIntent(intent(), context(IMAGE_ID));
      expect(outcome.status).toBe('applied');
      expect(onlyTool(useRulerStore()).frame).toBe(7);
    });

    it('applies a frameless tool to a cine target (every frame)', async () => {
      markCine(8);
      rulerOnlyFile();
      const outcome = await applyIntent(intent(), context(IMAGE_ID));
      expect(outcome.status).toBe('applied');
      expect(onlyTool(useRulerStore()).frame).toBeUndefined();
    });

    // Fractional and negative frames are not frames at all, so they die in the
    // wire decoder and take the whole result with them.
    it.each([
      ['fractional', 1.5],
      ['negative', -1],
    ])(
      'rejects the whole result for a %s frame on a cine target',
      async (_label, frame) => {
        markCine(8);
        rulerOnlyFile(frame);
        const outcome = await applyIntent(intent(), context(IMAGE_ID));
        expect(outcome.status).toBe('failed');
        // All-or-nothing: nothing may land.
        expect(toolCounts()).toEqual({ rulers: 0, rectangles: 0, polygons: 0 });
      }
    );

    // A frame beyond the clip is only judgeable against the target image, and
    // the contract makes it advisory: drop it rather than lose the result.
    it('drops an out-of-range frame on a cine target', async () => {
      markCine(8);
      rulerOnlyFile(8);
      const outcome = await applyIntent(intent(), context(IMAGE_ID));
      expect(outcome.status).toBe('applied');
      expect(onlyTool(useRulerStore()).frame).toBeUndefined();
    });
  });
});
