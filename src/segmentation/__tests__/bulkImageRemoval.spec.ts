import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createVuetify } from 'vuetify';
import { createPinia, setActivePinia } from 'pinia';
import type { Vector3 } from '@kitware/vtk.js/types';

import {
  activateAppPinia,
  inMemoryArtifactIO,
  manifestForImages,
  savedLabelmaps,
  savedSegments,
  seatImage,
  seedVoxel,
  serializeAnnotations,
  serializeToStateFiles,
  showImage,
  viewImage,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { useSegmentationEditsStore } from '@/src/segmentation/editing/coordinator';
import ProcessWorkflow from '@/src/segmentation/components/ProcessWorkflow.vue';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useImageStatsStore } from '@/src/store/image-stats';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useToolSelectionStore } from '@/src/store/tools/toolSelection';
import { removeSelectedTools, useToolStore } from '@/src/store/tools';
import { AnnotationToolType, Tools } from '@/src/store/tools/types';

enableAutoUnmount(afterEach);

const detached = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const annotation = (imageID: string, segmentId: string, placing = false) => ({
  imageID,
  segmentId,
  placing,
  slice: 0,
  frameOfReference: {
    planeOrigin: [0, 0, 0] as Vector3,
    planeNormal: [0, 0, 1] as Vector3,
  },
});

const ruler = (imageID: string, segmentId: string, placing = false) => ({
  ...annotation(imageID, segmentId, placing),
  firstPoint: [0, 0, 0] as Vector3,
  secondPoint: [1, 1, 0] as Vector3,
});

const polygon = (imageID: string, segmentId: string, placing = false) => ({
  ...annotation(imageID, segmentId, placing),
  points: [
    [0, 0, 0],
    [2, 0, 0],
    [1, 2, 0],
  ] as Vector3[],
});

const configuredCatalog = async (count: number) => {
  const segmentStore = useSegmentStore();
  const rulers = useRulerStore();
  await seatImage('b');
  await seatImage('a');
  await showImage('b');
  segmentStore.segments.applyConfig(
    Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        `Label ${index}`,
        { color: '#336699' },
      ])
    )
  );
  segmentStore.segments.segmentList('b').forEach(({ id }) => {
    rulers.addRuler(ruler('b', id));
  });
  await showImage('a');
  return { segmentStore, registry: segmentStore.segments, rulers };
};

describe('bulk image segment removal', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('removes a configured empty catalog and preserves the remaining definitions and complete ruler geometry', async () => {
    const { registry, rulers } = await configuredCatalog(32);
    const beforeSegments = detached(registry.segmentList('b'));
    const beforeRulers = detached(rulers.serializeTools());
    const removedIds = registry.segmentList('a').map(({ id }) => id);
    expect(
      new Set([...removedIds, ...beforeSegments.map(({ id }) => id)]).size
    ).toBe(64);
    const cancelPreview = vi.fn();
    useSegmentationEditsStore().hold(cancelPreview);

    useImageCacheStore().removeImage('a');

    const saved = serializeAnnotations(manifestForImages(['b'], { tools: {} }));
    expect(savedSegments(saved)).toEqual(beforeSegments);
    expect(saved.tools?.rulers).toEqual(beforeRulers);
    expect(saved.imageSegments?.map(({ imageId }) => imageId)).toEqual(['b']);
    removedIds.forEach((removed) =>
      expect(savedSegments(saved).map(({ id }) => id)).not.toContain(removed)
    );
    expect(cancelPreview).not.toHaveBeenCalled();
  });

  it('evicts masks and finished, placing and unnamed tools synchronously while preserving the other image', async () => {
    const { registry, rulers } = await configuredCatalog(2);
    const masks = useSegmentationStore();
    const aSegments = registry.segmentList('a');
    const b = registry.segmentList('b')[0].id;
    const shapeStores = [
      { store: rulers, makeTool: ruler },
      { store: useRectangleStore(), makeTool: ruler },
      { store: usePolygonStore(), makeTool: polygon },
    ];
    const tools = shapeStores.map(({ store, makeTool }) => ({
      store,
      removed: [
        ...aSegments.map(({ id }) => store.addTool(makeTool('a', id))),
        store.addTool(makeTool('a', aSegments[0].id, true)),
        store.addTool(makeTool('a', '')),
      ],
      retained: store.addTool(makeTool('b', b)),
    }));
    const originalTools = tools.map(({ store }) =>
      detached(
        store.serializeTools().tools.filter(({ imageID }) => imageID === 'b')
      )
    );
    aSegments.forEach(({ id }, index) =>
      seedVoxel(masks.resolveEditTarget('a', id), [index, 0, 0])
    );
    seedVoxel(masks.resolveEditTarget('b', b), [1, 1, 0]);
    const originalB = originalTools[0];
    registry.updateDisplay('a', {
      fillOpacity: 0.8,
      outlineThickness: 4,
    });
    const selection = useToolSelectionStore();
    const selectedA = tools[0].removed[0];
    const selectedB = tools[0].retained;
    selection.addSelection(selectedA, AnnotationToolType.Ruler);
    selection.addSelection(selectedB, AnnotationToolType.Ruler);
    const cancelPreview = vi.fn();
    useSegmentationEditsStore().hold(cancelPreview);

    useImageCacheStore().removeImage('a');

    const saved = serializeAnnotations(manifestForImages(['b'], { tools: {} }));
    expect(saved.tools?.rulers?.tools).toEqual(originalB);
    expect(savedSegments(saved)).toEqual(registry.segmentList('b'));
    tools.forEach(({ store, removed }, index) => {
      removed.forEach((id) => store.placeTool(id));
      expect(store.serializeTools().tools).toEqual(originalTools[index]);
    });
    expect(cancelPreview).toHaveBeenCalledTimes(1);
    removeSelectedTools();
    expect(rulers.serializeTools().tools).toEqual(
      originalB.filter(({ id }) => id !== selectedB)
    );
    const io = inMemoryArtifactIO();
    const { parsed } = await serializeToStateFiles(
      manifestForImages(['b']),
      io
    );
    expect(savedLabelmaps(parsed)).toMatchObject([
      {
        imageId: 'b',
        segmentId: b,
        labelmap: { extent: [1, 1, 1, 1, 0, 0] },
      },
    ]);
    expect(
      io.snapshots.flatMap(({ values }) => values.filter(Boolean))
    ).toEqual([1]);
  });

  it('closes the process preview when its image is removed', async () => {
    activateAppPinia();
    useImageStatsStore().stats.a = {
      scalarMin: 0,
      scalarMax: 0,
      autoRangeValues: {},
    };
    await viewImage('a');
    const masks = useSegmentationStore();
    seedVoxel(masks.resolveEditTarget('a'), [0, 0, 0]);
    useToolStore().setCurrentTool(Tools.Paint);
    const workflow = mount(ProcessWorkflow, {
      props: {
        algorithm: async ({ scalars, maskExtent }) => ({
          scalars: new Uint8Array(scalars.length),
          extent: maskExtent,
        }),
      },
      global: { plugins: [createVuetify()] },
    });
    await workflow.get('button').trigger('click');
    await flushPromises();
    expect(workflow.text()).toContain('Processed');
    expect(workflow.text()).toContain('Cancel');

    useImageCacheStore().removeImage('a');

    await nextTick();
    expect(workflow.text()).not.toContain('Cancel');
    expect(workflow.get('button').text()).toBe('Preview');
    expect(workflow.get('button').attributes('disabled')).toBeDefined();
    const { parsed } = await serializeToStateFiles(
      manifestForImages([]),
      inMemoryArtifactIO()
    );
    expect(savedLabelmaps(parsed)).toEqual([]);
  });
});
