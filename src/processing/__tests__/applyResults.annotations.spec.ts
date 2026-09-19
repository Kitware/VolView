import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

import {
  appApplyDependencies,
  applyIntent,
} from '@/src/processing/applyResults';
import type {
  ProcessingResult,
  SubmittedJobContext,
} from '@/src/processing/types';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { cssColorToRGBA } from '@/src/segmentation/color';
import { useMessageStore } from '@/src/store/messages';
import { TOOL_COLORS } from '@/src/config';
import {
  mintSegment,
  lockSegment,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useViewStore } from '@/src/store/views';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';

// ---------------------------------------------------------------------------
// Applying an `add-annotations` result.
//
// The stores are REAL here: the contract this exercises is what actually lands
// in a session — the derived slice, the label ids `addTool` re-reads styles
// from, and the durable `source` receipt — none of which a store double could
// tell the truth about. Only the heavy import/download edges are mocked.
// ---------------------------------------------------------------------------

// Stands in for the download edge: records what was asked for and hands back
// whatever the test last served.
const resultServer = () => {
  const downloads: ProcessingResult[] = [];
  let body = '';
  return {
    downloads,
    serve: (next: unknown) => {
      body = typeof next === 'string' ? next : JSON.stringify(next);
    },
    fetchResult: async (result: ProcessingResult) => {
      downloads.push(result);
      return new File([body], 'out.annotations.json', {
        type: 'application/json',
      });
    },
  };
};

let results = resultServer();

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

const serveFile = (body: unknown) => results.serve(body);

const apply = (
  resultIntent: Parameters<typeof applyIntent>[0],
  jobContext: Parameters<typeof applyIntent>[1]
) =>
  applyIntent(resultIntent, jobContext, {
    ...appApplyDependencies(),
    fetchResult: results.fetchResult,
  });

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
  results = resultServer();
  setActivePinia(createPinia());
  seatImage();
  serveFile(annotationsFile());
});

describe('applyIntent — add-annotations', () => {
  it('adds every tool kind to the job image, deriving the slice from the frame', async () => {
    const outcome = await apply(intent(), context(IMAGE_ID));
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

    const outcome = await apply(intent(), context(imageID));

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

      const outcome = await apply(intent(), context(IMAGE_ID));

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

    const outcome = await apply(intent(), context(IMAGE_ID));

    expect(outcome.status).toBe('failed');
    expect(String((outcome as { error: Error }).error)).toContain(
      'nonzero vector'
    );
    expect(toolCounts()).toEqual({ rulers: 0, rectangles: 0, polygons: 0 });
  });

  it('gives one segment to a name that repeats across kinds', async () => {
    await apply(intent(), context(IMAGE_ID));

    const rulers = useRulerStore();
    const rectangles = useRectangleStore();
    const polygons = usePolygonStore();
    const ruler = onlyTool(rulers);
    const rectangle = onlyTool(rectangles);

    // One registry: the name is the segment, whichever tool drew the shape.
    expect(ruler.segmentId).toBe(rectangle.segmentId);
    expect(rulers.appearanceOfTool(ruler.id).name).toBe('roi');
    // A different name is still a different segment.
    expect(onlyTool(polygons).segmentId).not.toBe(ruler.segmentId);

    // Every kind declared a style for the name; the first to bind it wins.
    expect(rectangles.appearanceOfTool(rectangle.id).cssColor).toBe('#ff0000');
    expect(rectangles.appearanceOfTool(rectangle.id).strokeWidth).toBe(3);
  });

  it('binds an existing segment of the same name instead of minting one', async () => {
    const rulerStore = useRulerStore();
    const registry = useSegmentStore().segments;
    const existingId = registry.addSegment({
      name: 'Measured',
      color: cssColorToRGBA('#ff0000'),
    });
    const before = registry.segmentList.value.length;

    const file = annotationsFile();
    file.labels.rulers = { Measured: { color: '#123456', strokeWidth: 3 } };
    file.tools.rulers[0].labelName = 'Measured';
    file.tools.rectangles = [];
    file.tools.polygons = [];
    serveFile(file);

    expect((await apply(intent(), context(IMAGE_ID))).status).toBe('applied');
    expect(registry.segmentList.value).toHaveLength(before);
    // The registry's own appearance wins on a name match.
    expect(registry.appearanceOf(existingId).cssColor).toBe('#ff0000');
    expect(onlyTool(rulerStore).segmentId).toBe(existingId);
  });

  it('keeps a segment’s colour when a label states one the parser rejects', async () => {
    const registry = useSegmentStore().segments;
    const existingId = registry.addSegment({
      name: 'Measured',
      color: cssColorToRGBA('#ff0000'),
    });

    const file = annotationsFile();
    // Functional CSS colours are not part of the accepted syntax.
    file.labels.rulers = {
      Measured: { color: 'rgb(0, 255, 0)' },
      Fresh: { color: 'rgb(0, 255, 0)' },
    };
    file.tools.rulers = [
      { ...file.tools.rulers[0], labelName: 'Measured' },
      { ...file.tools.rulers[0], labelName: 'Fresh' },
    ];
    file.tools.rectangles = [];
    file.tools.polygons = [];
    serveFile(file);

    expect((await apply(intent(), context(IMAGE_ID))).status).toBe('applied');

    // The bound segment keeps what it had, and a minted one keeps its
    // automatic palette colour — neither turns opaque black.
    expect(registry.appearanceOf(existingId).cssColor).toBe('#ff0000');
    const minted = registry.segmentList.value.find(
      (segment) => segment.name === 'Fresh'
    )!;
    expect(TOOL_COLORS).toContain(registry.appearanceOf(minted.id).cssColor);

    const titles = useMessageStore().messages.map((message) => message.title);
    expect(titles).toHaveLength(1);
    expect(titles[0]).toContain('Measured (rgb(0, 255, 0))');
    expect(titles[0]).toContain('Fresh (rgb(0, 255, 0))');
  });

  it('applies a hex or CSS keyword label colour', async () => {
    const file = annotationsFile();
    file.labels.rulers = { Hexed: { color: '#00ff00' } };
    file.tools.rulers[0].labelName = 'Hexed';
    file.labels.polygons = { Named: { color: 'lime' } };
    file.tools.polygons[0].labelName = 'Named';
    file.tools.rectangles = [];
    serveFile(file);

    expect((await apply(intent(), context(IMAGE_ID))).status).toBe('applied');

    const rulers = useRulerStore();
    const polygons = usePolygonStore();
    expect(rulers.appearanceOfTool(onlyTool(rulers).id).cssColor).toBe(
      '#00ff00'
    );
    expect(polygons.appearanceOfTool(onlyTool(polygons).id).cssColor).toBe(
      '#00ff00'
    );
    expect(useMessageStore().messages).toHaveLength(0);
  });

  it('binds a locked segment’s type without touching its mask', async () => {
    const segmentationStore = useSegmentationStore();
    const segmentation = segmentationStore.ensureSegmentationForImage(IMAGE_ID);
    const lockedSegment = mintSegment({
      name: 'roi',
      color: [17, 34, 51, 255],
    });
    const locked = segmentationStore.createMask(segmentation.id, lockedSegment);
    const voxels = segmentationStore.maskVoxels(locked.id);
    voxels.materialize();
    const labelValue = SEGMENT_VALUE;
    voxels.ensureContains([2, 2, 3, 3, 4, 4]);
    voxels.scalars()[0] = labelValue;
    voxels.image().modified();
    lockSegment(locked.id, true);
    const maskBefore = voxels.image();
    const bindingBefore = {
      ...voxels.binding()!,
      extent: [...voxels.binding()!.extent],
    };
    const scalarsBefore = Array.from(voxels.snapshot());

    const file = annotationsFile();
    file.tools.rulers = [];
    file.tools.polygons = [];
    serveFile(file);

    expect((await apply(intent(), context(IMAGE_ID))).status).toBe('applied');
    expect(segmentation.order).toEqual([locked.id]);
    expect(segmentationStore.getMask(locked.id)).toMatchObject({
      segmentId: lockedSegment,
      representations: { labelmap: bindingBefore },
    });
    expect(useSegmentStore().segments.appearanceOf(lockedSegment).locked).toBe(
      true
    );
    expect(voxels.image()).toBe(maskBefore);
    expect(Array.from(voxels.snapshot())).toEqual(scalarsBefore);
    // The shape names the type, not this image's mask for it.
    expect(onlyTool(useRectangleStore()).segmentId).toBe(lockedSegment);
  });

  it('leaves the picker where the user left it', async () => {
    const rulerStore = useRulerStore();
    const registry = useSegmentStore().segments;
    const selectedBefore = registry.addSegment({ name: 'Chosen' });
    expect(registry.selectedSegmentId.value).toBe(selectedBefore);

    const file = annotationsFile();
    // A name no type carries, so binding must MINT one, the case that could
    // steal the selection.
    file.labels.rulers = { fresh: { color: '#abcdef' } };
    file.tools.rulers[0].labelName = 'fresh';
    serveFile(file);

    expect((await apply(intent(), context(IMAGE_ID))).status).toBe('applied');
    expect(registry.selectedSegmentId.value).toBe(selectedBefore);
    // The type still landed; only the picker was left alone.
    const ruler = onlyTool(rulerStore);
    expect(rulerStore.appearanceOfTool(ruler.id).name).toBe('fresh');
  });

  it('preserves the user’s selected type while result segments land', async () => {
    seatImage('origin-image');
    seatImage('next-image');
    const segmentationStore = useSegmentationStore();
    const originSegmentation =
      segmentationStore.ensureSegmentationForImage('origin-image');
    const selectedSegment = mintSegment({ name: 'User selection' });
    segmentationStore.createMask(originSegmentation.id, selectedSegment);
    useSegmentStore().segments.selectSegment(selectedSegment);
    useViewStore().setDataForAllViews(IMAGE_ID);
    await nextTick();

    expect((await apply(intent(), context(IMAGE_ID))).status).toBe('applied');
    expect(useSegmentStore().segments.selectedSegmentId.value).toBe(
      selectedSegment
    );

    const next = segmentationStore.resolveEditTarget('next-image');
    expect(segmentationStore.getMask(next).segmentId).toBe(selectedSegment);
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

    expect((await apply(intent(), context(IMAGE_ID))).status).toBe('applied');
    const ruler = onlyTool(useRulerStore());
    expect(ruler.segmentId).toBe('');
    expect(useRulerStore().appearanceOfTool(ruler.id).name).toBe('');
  });

  it('is a no-op when a tool already carries the same source', async () => {
    expect((await apply(intent(), context(IMAGE_ID))).status).toBe('applied');
    results.downloads.length = 0;

    const second = await apply(intent(), context(IMAGE_ID));
    expect(second.status).toBe('applied');
    expect(toolCounts()).toEqual({ rulers: 1, rectangles: 1, polygons: 1 });
    // The receipt short-circuits before the download.
    expect(results.downloads).toEqual([]);
  });

  it('re-applies a result from a different job even at the same output id', async () => {
    await apply(intent(), context(IMAGE_ID));
    const other = { ...source, jobId: 'job-2' };
    await apply(intent({ source: other }), context(IMAGE_ID));
    expect(toolCounts()).toEqual({ rulers: 2, rectangles: 2, polygons: 2 });
  });

  it('applies an empty result as a no-op', async () => {
    serveFile({ schemaVersion: 1, space: 'LPS', tools: {} });
    const outcome = await apply(intent(), context(IMAGE_ID));
    expect(outcome.status).toBe('applied');
    expect(toolCounts()).toEqual({ rulers: 0, rectangles: 0, polygons: 0 });
  });

  it('fails without ever downloading when no image is bound', async () => {
    const outcome = await apply(intent(), context(undefined));
    expect(outcome.status).toBe('failed');
    expect(String((outcome as { error: Error }).error)).toContain(
      "Load the job's input image"
    );
    expect(results.downloads).toEqual([]);
    expect(toolCounts()).toEqual({ rulers: 0, rectangles: 0, polygons: 0 });
  });

  it('fails when the bound image is no longer in the cache', async () => {
    const outcome = await apply(intent(), context('img-gone'));
    expect(outcome.status).toBe('failed');
    expect(results.downloads).toEqual([]);
  });

  it('fails on a malformed result body without touching the stores', async () => {
    serveFile('not json at all');
    const outcome = await apply(intent(), context(IMAGE_ID));
    expect(outcome.status).toBe('failed');
    expect(toolCounts()).toEqual({ rulers: 0, rectangles: 0, polygons: 0 });
  });

  it('rejects the whole result when any frame is not axis-aligned, before mutating', async () => {
    const rulerStore = useRulerStore();
    const typesBefore = rulerStore.segments.segmentList.value.map((type) => ({
      ...type,
    }));

    const file = annotationsFile();
    // Oblique: unrenderable, and no `slice` echo can rescue it.
    file.tools.polygons[0].frameOfReference = {
      planeNormal: [0, 0.7071, 0.7071],
      planeOrigin: [0, 0, 3],
    };
    serveFile(file);

    const outcome = await apply(intent(), context(IMAGE_ID));
    expect(outcome.status).toBe('failed');
    expect(String((outcome as { error: Error }).error)).toContain(
      'not aligned'
    );
    // All-or-nothing: not even the rulers that WOULD have placed, and not the
    // registry, since binding a name mints or restyles a type.
    expect(toolCounts()).toEqual({ rulers: 0, rectangles: 0, polygons: 0 });
    expect(rulerStore.segments.segmentList.value).toEqual(typesBefore);
  });

  it('places a plane past the image bounds, as the renderer already does', async () => {
    const file = annotationsFile();
    file.tools.rectangles = [];
    file.tools.polygons = [];
    file.tools.rulers[0].frameOfReference = axialAt(500);
    serveFile(file);

    const outcome = await apply(intent(), context(IMAGE_ID));

    expect(outcome.status).toBe('applied');
    expect(onlyTool(useRulerStore()).slice).toBe(500);
  });

  it('rejects a plane that falls between slices, and says so', async () => {
    const file = annotationsFile();
    file.tools.rulers[0].frameOfReference = axialAt(5.5);
    serveFile(file);

    const outcome = await apply(intent(), context(IMAGE_ID));

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
    expect((await apply(intent(), context(IMAGE_ID))).status).toBe('failed');
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

    const outcome = await apply(intent(), context(IMAGE_ID));
    expect(outcome.status).toBe('failed');
    expect(toolCounts()).toEqual({ rulers: 0, rectangles: 0, polygons: 0 });
  });

  it('applies without a source when the producer omitted one', async () => {
    const outcome = await apply(
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
      const outcome = await apply(intent(), context(IMAGE_ID));
      expect(outcome.status).toBe('applied');
      expect(onlyTool(useRulerStore()).frame).toBeUndefined();
    });

    it('keeps an in-range integral frame on a cine target', async () => {
      markCine(8);
      rulerOnlyFile(7);
      const outcome = await apply(intent(), context(IMAGE_ID));
      expect(outcome.status).toBe('applied');
      expect(onlyTool(useRulerStore()).frame).toBe(7);
    });

    it('applies a frameless tool to a cine target (every frame)', async () => {
      markCine(8);
      rulerOnlyFile();
      const outcome = await apply(intent(), context(IMAGE_ID));
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
        const outcome = await apply(intent(), context(IMAGE_ID));
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
      const outcome = await apply(intent(), context(IMAGE_ID));
      expect(outcome.status).toBe('applied');
      expect(onlyTool(useRulerStore()).frame).toBeUndefined();
    });
  });
});
