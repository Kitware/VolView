import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

import {
  appApplyDependencies,
  applyIntent,
  autoLoadProcessingResults,
} from '@/src/processing/applyResults';
import type {
  ProcessingResult,
  SubmittedJobContext,
} from '@/src/processing/types';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useImageStore } from '@/src/store/datasets-images';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { cssColorToRGBA, rgbaToCssColor } from '@/src/segmentation/color';
import {
  messageDetails,
  messageTitles,
} from '@/src/components/__tests__/messageDisplay';
import { useProcessingJobsStore } from '@/src/processing/store';
import { useMessageStore } from '@/src/store/messages';
import { seatDataSource } from '@/src/store/__tests__/datasetFixtures';
import { makeFakeProvider, registerFake } from './fakeProvider';
import {
  savedMasks,
  serializeAnnotations,
  serializeScene,
} from './serializedScene';
import { TOOL_COLORS } from '@/src/config';
import {
  mintSegment,
  lockSegment,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useViewStore } from '@/src/store/views';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import { defer } from '@/src/utils';

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
    // Wire namespaces may style the same name differently. The first kind to
    // bind that name establishes its appearance in the shared scene registry.
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

const serveRulers = (file: WireFile) =>
  serveFile({
    ...file,
    tools: { ...file.tools, rectangles: [], polygons: [] },
  });

const apply = (
  resultIntent: Parameters<typeof applyIntent>[0],
  jobContext: Parameters<typeof applyIntent>[1]
) =>
  applyIntent(resultIntent, jobContext, {
    ...appApplyDependencies(),
    fetchResult: results.fetchResult,
  });

const pauseApplyAt = (phase: 'download' | 'text') => {
  const pending = defer<File | string>();
  const entered = defer<void>();
  const body = JSON.stringify(annotationsFile());
  const file = new File([body], 'out.annotations.json');
  const operation = applyIntent(intent(), context(IMAGE_ID), {
    ...appApplyDependencies(),
    fetchResult: async () => {
      if (phase === 'download') {
        entered.resolve();
        return pending.promise as Promise<File>;
      }
      return {
        text: () => {
          entered.resolve();
          return pending.promise as Promise<string>;
        },
      } as File;
    },
  });
  return {
    entered: entered.promise,
    operation,
    release: () => pending.resolve(phase === 'download' ? file : body),
  };
};

const toolCounts = () => {
  const { tools } = serializeAnnotations();
  return {
    rulers: tools?.rulers?.tools.length ?? 0,
    rectangles: tools?.rectangles?.tools.length ?? 0,
    polygons: tools?.polygons?.tools.length ?? 0,
  };
};

const firstRuler = () => serializeAnnotations().tools!.rulers!.tools[0];
const firstRectangle = () => serializeAnnotations().tools!.rectangles!.tools[0];
const firstPolygon = () => serializeAnnotations().tools!.polygons!.tools[0];

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

    const ruler = firstRuler();
    expect(ruler.imageID).toBe(IMAGE_ID);
    // The wire said 99; the frame of reference says 5, and it wins.
    expect(ruler.slice).toBe(5);
    expect(ruler.firstPoint).toEqual([1, 1, 5]);
    expect(ruler.secondPoint).toEqual([4, 4, 5]);
    expect(ruler.name).toBe('Long axis');
    expect(ruler.metadata).toEqual({ origin: 'RulerToRectangle' });
    // The idempotency receipt is durable session state.
    expect(ruler.source).toEqual(source);

    expect(firstRectangle().slice).toBe(7);
    expect(firstPolygon()).toMatchObject({
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
    expect(firstRectangle()).toMatchObject({
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
      expect(firstRuler().frameOfReference.planeNormal).toEqual(expected);
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

    const saved = serializeAnnotations();
    const ruler = saved.tools!.rulers!.tools[0];
    const rectangle = saved.tools!.rectangles!.tools[0];
    expect(ruler.segmentId).toBe(rectangle.segmentId);
    expect(saved.tools!.polygons!.tools[0].segmentId).not.toBe(ruler.segmentId);
    expect(
      saved.segments?.find(({ id }) => id === ruler.segmentId)
    ).toMatchObject({
      name: 'roi',
      color: [255, 0, 0, 255],
      strokeWidth: 3,
    });
  });

  it('binds an existing segment of the same name instead of minting one', async () => {
    const registry = useSegmentStore().segments;
    const existingId = registry.addSegment({
      name: 'Measured',
      color: cssColorToRGBA('#ff0000'),
    });
    const before = serializeAnnotations().segments!.length;

    const file = annotationsFile();
    file.labels.rulers = { Measured: { color: '#123456', strokeWidth: 3 } };
    file.tools.rulers[0].labelName = 'Measured';
    serveRulers(file);

    expect((await apply(intent(), context(IMAGE_ID))).status).toBe('applied');
    const saved = serializeAnnotations();
    expect(saved.segments).toHaveLength(before);
    expect(saved.segments?.find(({ id }) => id === existingId)?.color).toEqual([
      255, 0, 0, 255,
    ]);
    expect(firstRuler().segmentId).toBe(existingId);
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
    serveRulers(file);

    expect((await apply(intent(), context(IMAGE_ID))).status).toBe('applied');

    const saved = serializeAnnotations();
    expect(saved.segments?.find(({ id }) => id === existingId)?.color).toEqual([
      255, 0, 0, 255,
    ]);
    const minted = saved.segments!.find((segment) => segment.name === 'Fresh')!;
    expect(TOOL_COLORS).toContain(rgbaToCssColor(minted.color));

    const titles = messageTitles();
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

    expect(serializeAnnotations().segments).toMatchObject([
      { name: 'Hexed', color: [0, 255, 0, 255] },
      { name: 'Named', color: [0, 255, 0, 255] },
    ]);
    expect(messageTitles()).toHaveLength(0);
  });

  it('binds a locked segment without touching its mask', async () => {
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
    const before = await serializeScene([IMAGE_ID]);

    const file = annotationsFile();
    file.tools.rulers = [];
    file.tools.polygons = [];
    serveFile(file);

    expect((await apply(intent(), context(IMAGE_ID))).status).toBe('applied');
    const after = await serializeScene([IMAGE_ID]);
    expect(savedMasks(after, IMAGE_ID)).toEqual(savedMasks(before, IMAGE_ID));
    expect(savedMasks(after, IMAGE_ID)).toMatchObject([
      {
        id: locked.id,
        segmentId: lockedSegment,
        segment: { locked: true },
        extent: [2, 2, 3, 3, 4, 4],
        artifact: { values: [SEGMENT_VALUE] },
      },
    ]);
    expect(after.manifest.tools!.rectangles!.tools[0].segmentId).toBe(
      lockedSegment
    );
  });

  it('leaves the picker where the user left it', async () => {
    const registry = useSegmentStore().segments;
    const selectedBefore = registry.addSegment({ name: 'Chosen' });
    expect(serializeAnnotations().selectedSegment).toBe(selectedBefore);

    const file = annotationsFile();
    // A name no segment carries, so binding must MINT one, the case that could
    // steal the selection.
    file.labels.rulers = { fresh: { color: '#abcdef' } };
    file.tools.rulers[0].labelName = 'fresh';
    serveFile(file);

    expect((await apply(intent(), context(IMAGE_ID))).status).toBe('applied');
    expect(serializeAnnotations().selectedSegment).toBe(selectedBefore);
    // The segment still landed; only the picker was left alone.
    const ruler = firstRuler();
    expect(
      serializeAnnotations().segments?.find(({ id }) => id === ruler.segmentId)
        ?.name
    ).toBe('fresh');
  });

  it('preserves the user’s selected segment while result segments land', async () => {
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
    expect(serializeAnnotations().selectedSegment).toBe(selectedSegment);

    const next = segmentationStore.resolveEditTarget('next-image');
    expect(
      savedMasks(
        await serializeScene(['origin-image', IMAGE_ID, 'next-image']),
        'next-image'
      )
    ).toMatchObject([{ id: next, segmentId: selectedSegment }]);
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
    serveRulers(file);

    expect((await apply(intent(), context(IMAGE_ID))).status).toBe('applied');
    const ruler = firstRuler();
    expect(ruler.segmentId).toBe('');
    expect(serializeAnnotations().segments).toEqual([]);
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

  it.each(['download', 'text'] as const)(
    'does not mutate the scene when the submitted image is deleted during %s',
    async (phase) => {
      const otherImage = 'healthy-image';
      seatImage(otherImage);
      const registry = useSegmentStore().segments;
      const existingSegment = registry.addSegment({ name: 'Existing' });
      const existingTool = useRulerStore().addTool({
        imageID: otherImage,
        segmentId: existingSegment,
        placing: false,
      });
      const paused = pauseApplyAt(phase);

      await paused.entered;
      useImageCacheStore().removeImage(IMAGE_ID);
      useViewStore().setDataForAllViews(otherImage);
      paused.release();

      const outcome = await paused.operation;
      expect(outcome.status).toBe('failed');
      expect(toolCounts()).toEqual({ rulers: 1, rectangles: 0, polygons: 0 });
      const saved = serializeAnnotations();
      expect(saved.tools!.rulers!.tools).toMatchObject([
        {
          id: existingTool,
          imageID: otherImage,
          segmentId: existingSegment,
        },
      ]);
      expect(saved.segments?.map(({ name }) => name)).toEqual(['Existing']);
      expect((await apply(intent(), context(otherImage))).status).toBe(
        'applied'
      );
    }
  );

  it.each(['download', 'text'] as const)(
    'keeps targeting the submitted image when the current image changes during %s',
    async (phase) => {
      const otherImage = 'current-image';
      seatImage(otherImage);
      const paused = pauseApplyAt(phase);

      await paused.entered;
      useViewStore().setDataForAllViews(otherImage);
      paused.release();

      expect((await paused.operation).status).toBe('applied');
      expect(toolCounts()).toEqual({ rulers: 1, rectangles: 1, polygons: 1 });
      expect([
        firstRuler().imageID,
        firstRectangle().imageID,
        firstPolygon().imageID,
      ]).toEqual([IMAGE_ID, IMAGE_ID, IMAGE_ID]);
    }
  );

  it('fails on a malformed result body without touching the stores', async () => {
    serveFile('not json at all');
    const outcome = await apply(intent(), context(IMAGE_ID));
    expect(outcome.status).toBe('failed');
    expect(toolCounts()).toEqual({ rulers: 0, rectangles: 0, polygons: 0 });
  });

  it('rejects the whole result when any frame is not axis-aligned, before mutating', async () => {
    const typesBefore = serializeAnnotations().segments;

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
    // registry, since binding a name mints or restyles a segment.
    expect(toolCounts()).toEqual({ rulers: 0, rectangles: 0, polygons: 0 });
    expect(serializeAnnotations().segments).toEqual(typesBefore);
  });

  it('places a plane past the image bounds, as the renderer already does', async () => {
    const file = annotationsFile();
    file.tools.rectangles = [];
    file.tools.polygons = [];
    file.tools.rulers[0].frameOfReference = axialAt(500);
    serveFile(file);

    const outcome = await apply(intent(), context(IMAGE_ID));

    expect(outcome.status).toBe('applied');
    expect(firstRuler().slice).toBe(500);
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

  it('mints the receipt from the submitted job when the producer omitted a source', async () => {
    const unsourced = intent({ source: undefined });
    expect((await apply(unsourced, context(IMAGE_ID))).status).toBe('applied');
    expect(firstRuler().source).toEqual({
      providerId: 'provider-1',
      jobId: 'job-1',
      outputId: 'r1',
    });

    await apply(unsourced, context(IMAGE_ID));
    expect(toolCounts()).toEqual({ rulers: 1, rectangles: 1, polygons: 1 });
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
      serveRulers(file);
    };

    it('drops a stray frame when the target is a static volume', async () => {
      rulerOnlyFile(3);
      const outcome = await apply(intent(), context(IMAGE_ID));
      expect(outcome.status).toBe('applied');
      expect(firstRuler().frame).toBeUndefined();
    });

    it('keeps an in-range integral frame on a cine target', async () => {
      markCine(8);
      rulerOnlyFile(7);
      const outcome = await apply(intent(), context(IMAGE_ID));
      expect(outcome.status).toBe('applied');
      expect(firstRuler().frame).toBe(7);
    });

    it('applies a frameless tool to a cine target (every frame)', async () => {
      markCine(8);
      rulerOnlyFile();
      const outcome = await apply(intent(), context(IMAGE_ID));
      expect(outcome.status).toBe('applied');
      expect(firstRuler().frame).toBeUndefined();
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
      expect(firstRuler().frame).toBeUndefined();
    });
  });
});

describe('retrying annotations after loading the input image', () => {
  const inputUri = '/job-input.nrrd';
  const jobRef = { providerId: 'provider-1', jobId: 'job-1' };
  const detail = {
    jobId: jobRef.jobId,
    log: [],
    parameters: { inputVolume: { type: 'image', uris: [inputUri] } },
  };

  const adoptedJob = async (reloaded = false) => {
    serveRulers(annotationsFile());
    const provider = makeFakeProvider(
      {
        id: jobRef.providerId,
        label: 'Analysis',
        baseUrl: '/',
        jobsBaseUrl: '/',
      },
      {
        listJobHistory: vi.fn().mockResolvedValue({
          jobs: [
            {
              jobId: jobRef.jobId,
              taskId: 'task-1',
              taskTitle: 'Annotate',
              createdBy: { id: 'user-1', name: 'User' },
              createdAt: '2026-07-03T19:00:00Z',
              state: 'success',
              resultState: 'ready',
            },
          ],
          nextCursor: null,
        }),
        getJobHistoryDetail: vi.fn().mockResolvedValue(detail),
        getResults: vi
          .fn()
          .mockResolvedValueOnce({ results: [intent()], missing: 0 })
          .mockRejectedValue(new Error('Results requested more than once')),
      }
    );
    const jobs = useProcessingJobsStore();
    registerFake(jobs, provider);
    await jobs.adoptJobHistory();
    const loadAndApply = async () => {
      await jobs.loadJobResults(jobRef);
      await jobs.applyJobResults(jobRef, (pending, submitted) =>
        autoLoadProcessingResults(pending, submitted, {
          ...appApplyDependencies(),
          fetchResult: results.fetchResult,
        })
      );
    };
    if (reloaded) {
      registerInput(IMAGE_ID);
      await jobs.loadJobResults(jobRef);
      useImageStore().deleteData(IMAGE_ID);
      await nextTick();
    }
    await loadAndApply();
    expect(messageDetails('Failed to apply out.annotations.json')).toContain(
      "Load the job's input image"
    );
    expect(toolCounts()).toEqual({ rulers: 0, rectangles: 0, polygons: 0 });
    useMessageStore().clearAll();
    return { jobs, provider, loadAndApply };
  };

  const registerInput = (id: string) => {
    useImageStore().addVTKImageData(
      'CT',
      useImageCacheStore().getVtkImageData(id)!,
      { id }
    );
    seatDataSource(id, { type: 'uri', uri: inputUri, name: 'job-input.nrrd' });
  };

  const loadInput = () => {
    seatImage('reopened');
    registerInput('reopened');
  };

  it.each([false, true])(
    'applies the cached result once with its appearance after reloading=%s',
    async (reloaded) => {
      const { loadAndApply } = await adoptedJob(reloaded);
      loadInput();
      await loadAndApply();
      await loadAndApply();

      expect(messageTitles()).toEqual([]);
      expect(toolCounts()).toEqual({ rulers: 1, rectangles: 0, polygons: 0 });
      const saved = serializeAnnotations();
      const ruler = saved.tools!.rulers!.tools[0];
      expect(ruler).toMatchObject({
        imageID: 'reopened',
        firstPoint: [1, 1, 5],
        secondPoint: [4, 4, 5],
        name: 'Long axis',
        source,
      });
      expect(
        saved.segments?.find(({ id }) => id === ruler.segmentId)
      ).toMatchObject({ name: 'roi', color: [255, 0, 0, 255] });
    }
  );

  it('does not apply a cached result after deletion during parent lookup', async () => {
    const { jobs, provider, loadAndApply } = await adoptedJob();
    loadInput();
    const entered = defer<void>();
    const released = defer<typeof detail>();
    provider.getJobHistoryDetail.mockImplementationOnce(() => {
      entered.resolve();
      return released.promise;
    });

    const loading = loadAndApply();
    await entered.promise;
    await jobs.deleteJob(jobRef);
    released.resolve(detail);
    await loading;

    expect(messageTitles()).toEqual([]);
    expect(toolCounts()).toEqual({ rulers: 0, rectangles: 0, polygons: 0 });
  });
});
