import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { Vector3 } from '@kitware/vtk.js/types';

import {
  activateAppPinia,
  manifestForImages,
  makeLabelmap,
  markedVoxels,
  seatImage,
  seedVoxel,
  serializeAnnotations,
  showImage,
  viewImage,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { useSegmentationEditsStore } from '@/src/segmentation/editing/coordinator';
import { usePaintProcessStore } from '@/src/segmentation/editing/paintProcess';
import { maskScalars } from '@/src/segmentation/model';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useImageStatsStore } from '@/src/store/image-stats';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useToolSelectionStore } from '@/src/store/tools/toolSelection';
import { AnnotationToolType } from '@/src/store/tools/types';

const detached = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const ruler = (imageID: string, segmentId: string, placing = false) => ({
  imageID,
  segmentId,
  placing,
  slice: 0,
  frameOfReference: {
    planeOrigin: [0, 0, 0] as Vector3,
    planeNormal: [0, 0, 1] as Vector3,
  },
  firstPoint: [0, 0, 0] as Vector3,
  secondPoint: [1, 1, 0] as Vector3,
});

const copiedCatalog = async (count: number) => {
  const segmentStore = useSegmentStore();
  const rulers = useRulerStore();
  await seatImage('b');
  await seatImage('a');
  await showImage('b');
  segmentStore.replaceConfigSegments(
    Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        `Label ${index}`,
        { color: '#336699' },
      ])
    ),
    ['b']
  );
  segmentStore.segments.segmentList('b').forEach(({ id }) => {
    rulers.addRuler(ruler('b', id));
  });
  await showImage('a');
  return { segmentStore, registry: segmentStore.segments, rulers };
};

describe('bulk image segment removal', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('removes a copied empty catalog and preserves the remaining definitions and complete ruler geometry', async () => {
    const { registry, rulers } = await copiedCatalog(32);
    const masks = useSegmentationStore();
    const beforeSegments = detached(registry.segmentList('b'));
    const beforeRulers = detached(rulers.serializeTools());
    const removedIds = registry.segmentList('a').map(({ id }) => id);
    expect(
      new Set([...removedIds, ...beforeSegments.map(({ id }) => id)]).size
    ).toBe(64);
    expect(masks.segmentations).toEqual({});
    const cancelPreview = vi.fn();
    useSegmentationEditsStore().hold(cancelPreview);

    useImageCacheStore().removeImage('a');

    const saved = serializeAnnotations(manifestForImages(['b'], { tools: {} }));
    expect(saved.segments).toEqual(beforeSegments);
    expect(saved.tools?.rulers).toEqual(beforeRulers);
    expect(saved.imageSegmentSets?.map(({ imageId }) => imageId)).toEqual([
      'b',
    ]);
    removedIds.forEach((removed) =>
      expect(saved.segments?.map(({ id }) => id)).not.toContain(removed)
    );
    expect(masks.segmentations).toEqual({});
    expect(cancelPreview).not.toHaveBeenCalled();
  });

  it('evicts masks and finished, placing and unnamed tools synchronously while preserving the other image', async () => {
    const { registry, rulers } = await copiedCatalog(2);
    const masks = useSegmentationStore();
    const aSegments = registry.segmentList('a');
    const b = registry.segmentList('b')[0].id;
    const shapeStores = [rulers, useRectangleStore(), usePolygonStore()];
    const tools = shapeStores.map((store) => ({
      store,
      removed: [
        ...aSegments.map(({ id }) => store.addTool(ruler('a', id))),
        store.addTool(ruler('a', aSegments[0].id, true)),
        store.addTool(ruler('a', '')),
      ],
      retained: store.addTool(ruler('b', b)),
    }));
    const aMasks = aSegments.map(({ id }) => masks.resolveEditTarget('a', id));
    aMasks.forEach((id, index) => seedVoxel(id, [index, 0, 0]));
    const bMask = masks.resolveEditTarget('b', b);
    seedVoxel(bMask, [1, 1, 0]);
    const originalB = detached(
      rulers.serializeTools().tools.filter(({ imageID }) => imageID === 'b')
    );
    const segmentationA = masks.getSegmentationForImage('a')!;
    masks.updateSegmentationDisplay(segmentationA.id, {
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
    expect(saved.segments).toEqual(registry.segmentList('b'));
    tools.forEach(({ store, removed, retained }) => {
      expect(removed.every((id) => !store.toolByID[id])).toBe(true);
      expect(store.toolByID[retained]?.segmentId).toBe(b);
    });
    expect(selection.isSelected(selectedA)).toBe(false);
    expect(selection.isSelected(selectedB)).toBe(true);
    expect(aMasks.every((id) => !masks.maskExists(id))).toBe(true);
    expect(masks.getSegmentationForImage('a')).toBeUndefined();
    expect(rulers.serializeTools().tools).toEqual(originalB);
    expect(markedVoxels(bMask)).toEqual([[1, 1, 0, 1]]);
    expect(cancelPreview).toHaveBeenCalledTimes(1);
  });

  it('rolls back a process preview before eviction removes its mask storage', async () => {
    activateAppPinia();
    useImageStatsStore().stats.a = {
      scalarMin: 0,
      scalarMax: 0,
      autoRangeValues: {},
    };
    await viewImage('a');
    const masks = useSegmentationStore();
    const maskId = masks.resolveEditTarget('a');
    seedVoxel(maskId, [0, 0, 0]);
    const image = masks.findMaskBinding(maskId)!.image;
    const original = maskScalars(image).slice();
    const process = usePaintProcessStore();
    await process.startProcess(async ({ scalars, maskExtent }) => ({
      scalars: new Uint8Array(scalars.length),
      extent: maskExtent,
    }));
    expect(process.processStep).toBe('previewing');
    expect(maskScalars(image)).not.toEqual(original);

    useImageCacheStore().removeImage('a');

    expect(process.processStep).toBe('start');
    expect(maskScalars(image)).toEqual(original);
    expect(masks.maskExists(maskId)).toBe(false);
  });

  it('releases every removed mask name without reserving it against another image', async () => {
    await seatImage('a', { name: 'CT' });
    await seatImage('b', { name: 'CT' });
    const store = useSegmentationStore();
    const registry = useSegmentStore().segments;
    const values = new Uint8Array(64);
    values[0] = 1;
    values[1] = 2;
    store.splitLabelmapIntoMasks(
      'a',
      makeLabelmap({ values }),
      [
        { value: 1, name: 'Tumor', color: [255, 0, 0, 255], visible: true },
        { value: 2, name: 'Node', color: [0, 255, 0, 255], visible: true },
      ],
      { name: 'Segment Group 2 for CT' }
    );

    useImageCacheStore().removeImage('a');

    const names = ['First', 'Second'].map((name) => {
      const segmentId = registry.addSegment('b', { name });
      const maskId = store.resolveEditTarget('b', segmentId);
      return store.ensureLabelmapBinding(maskId).name;
    });
    expect(names).toEqual(['Segment Group 1 for CT', 'Segment Group 2 for CT']);
  });
});
